/**
 * One schedule to read and change, with its runs, or a new one to make,
 * in place of the list. The form keeps the person's edits while the
 * record changes under it, and Save shows only while there are edits. A
 * schedule deleted while it shows says so.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  messageOf,
  type AppFacts,
  type Backend,
  type Choices,
  type Fields,
  type Listing,
  type Notify,
  type Schedule,
} from './client.ts';
import {
  Button,
  Icon,
  InfoRow,
  LinkRow,
  ListRow,
  Notice,
  SettingsCard,
  SettingsSection,
  SettingsSelect,
  ShellConfirm,
  StatusWord,
  TextInput,
} from './kit.tsx';
import { StateDot } from './marks.tsx';
import {
  BLANK_RHYTHM,
  DAYS,
  dateOptions,
  defaultOnce,
  fromSchedule,
  onceParts,
  ordinal,
  timeOptions,
  toTiming,
  type Repeat,
  type Rhythm,
} from './rhythm.ts';
import { outcome, relative, useTick } from './words.ts';

/** About ten rows of a date or time list before it scrolls. */
const PICKER_HEIGHT = 380;

const REPEATS: { value: Repeat; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'once', label: 'Once' },
  { value: 'custom', label: 'Custom' },
];

const NOTIFY: { value: Notify; label: string }[] = [
  { value: 'all', label: 'All runs' },
  { value: 'failures', label: 'Failures only' },
  { value: 'none', label: 'None' },
];

const WEEKDAYS = DAYS.map((d) => ({ value: d, label: d.charAt(0).toUpperCase() + d.slice(1) }));

const MONTH_DAYS = Array.from({ length: 28 }, (_, i) => ({
  value: String(i + 1),
  label: `The ${ordinal(i + 1)}`,
}));

interface Form {
  app: string;
  title: string;
  prompt: string;
  notify: Notify;
  /** Empty for the app's own choice. */
  model: string;
  /** Empty for none. */
  project: string;
  rhythm: Rhythm;
}

type Option = { value: string; label: string; sub?: string; disabled?: boolean };

function formOf(s: Schedule): Form {
  return {
    app: s.app,
    title: s.title,
    prompt: s.prompt,
    notify: s.notify,
    model: s.model ?? '',
    project: s.project ?? '',
    rhythm: fromSchedule(s),
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The zone the person's clock reads, which a new schedule's expression
 *  is read in. */
const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The expression a rhythm stands for, or none where it is a single
 *  instant or not complete. */
function specOf(r: Rhythm): string {
  try {
    const timing = toTiming(r);
    return 'spec' in timing ? timing.spec : '';
  } catch {
    return '';
  }
}

/** The fields of a form that differ from the record's. */
function changes(next: Form, before: Form): Partial<Fields> {
  const patch: Partial<Fields> = {};
  if (next.app !== before.app) patch.app = next.app;
  if (next.title.trim() !== before.title) patch.title = next.title.trim();
  if (next.prompt.trim() !== before.prompt) patch.prompt = next.prompt.trim();
  if (next.notify !== before.notify) patch.notify = next.notify;
  if (next.model !== before.model) patch.model = next.model;
  if (next.project !== before.project) patch.project = next.project;
  if (!same(next.rhythm, before.rhythm)) Object.assign(patch, toTiming(next.rhythm));
  return patch;
}

export function Detail({
  backend,
  id,
  onBack,
  onShow,
}: {
  backend: Backend;
  /** The schedule's id; null for a new one. */
  id: string | null;
  /** Shows the list again. */
  onBack: () => void;
  /** Shows the schedule the form made. */
  onShow: (id: string) => void;
}) {
  const fresh = id === null;
  const [listing, setListing] = useState<Listing | null>(null);
  const [apps, setApps] = useState<AppFacts[]>([]);
  const [draft, setDraft] = useState<Form | null>(null);
  const [choices, setChoices] = useState<Choices | null>(null);
  const [words, setWords] = useState<{ text: string; ok: boolean } | null>(null);
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [doomed, setDoomed] = useState(false);
  useTick();

  const load = useCallback(async () => {
    const [next, candidates] = await Promise.all([backend.list(), backend.apps()]);
    setListing(next);
    setApps(candidates);
  }, [backend]);
  useEffect(() => {
    const read = () => void load().catch((e: unknown) => setNotice(messageOf(e)));
    read();
    return backend.onChanged(read);
  }, [backend, load]);

  const schedule = fresh ? null : (listing?.schedules.find((s) => s.id === id) ?? null);
  const saved = useMemo<Form>(
    () =>
      schedule
        ? formOf(schedule)
        : {
            app: apps[0]?.id ?? '',
            title: '',
            prompt: '',
            notify: 'all',
            model: '',
            project: '',
            rhythm: BLANK_RHYTHM,
          },
    [schedule, apps],
  );
  const form = draft ?? saved;
  const dirty = draft !== null && !same(draft, saved);
  const edit = (p: Partial<Form>) => setDraft({ ...form, ...p });
  const editRhythm = (p: Partial<Rhythm>) => edit({ rhythm: { ...form.rhythm, ...p } });

  useEffect(() => {
    if (!form.app) return;
    let live = true;
    setChoices(null);
    backend
      .choices(form.app)
      .then((c) => live && setChoices(c))
      .catch((e: unknown) => live && setNotice(messageOf(e)));
    return () => {
      live = false;
    };
  }, [backend, form.app]);

  const cron = form.rhythm.repeat === 'custom' ? form.rhythm.cron.trim() : '';
  useEffect(() => {
    if (!cron) {
      setWords(null);
      return;
    }
    let live = true;
    backend
      .words(cron)
      .then((text) => live && setWords({ text, ok: true }))
      .catch((e: unknown) => live && setWords({ text: messageOf(e), ok: false }));
    return () => {
      live = false;
    };
  }, [backend, cron]);

  /** A new repeat, with a day that fits it; Custom starts from the
   *  expression of the rhythm before it, or opens its field empty. */
  const pickRepeat = (repeat: Repeat) => {
    const r = form.rhythm;
    const spec = repeat === 'custom' && !r.cron ? specOf(r) : r.cron;
    editRhythm({
      repeat,
      cron: spec,
      ...(repeat === 'once' && !r.once && { once: defaultOnce() }),
      ...(repeat === 'weekly' && !DAYS.includes(r.on) && { on: 'monday' }),
      ...(repeat === 'monthly' && !MONTH_DAYS.some((d) => d.value === r.on) && { on: '1' }),
    });
    if (repeat === 'custom' && !spec) setAdvanced(true);
  };

  const save = async () => {
    setNotice(null);
    setBusy(true);
    try {
      if (!form.title.trim()) throw new Error('Give the schedule a title.');
      if (!form.prompt.trim()) throw new Error('Write what the app is told.');
      if (!form.app) throw new Error('Pick the app it runs in.');
      if (schedule) {
        await backend.set(schedule.id, changes(form, saved), 'Save');
        await load();
        setDraft(null);
      } else {
        const made = await backend.create({
          app: form.app,
          title: form.title.trim(),
          prompt: form.prompt.trim(),
          notify: form.notify,
          model: form.model,
          project: form.project,
          ...toTiming(form.rhythm),
          timezone: localZone(),
        });
        onShow(made.id);
      }
    } catch (e) {
      setNotice(messageOf(e));
    } finally {
      setBusy(false);
    }
  };

  const openRun = (session: string) => {
    setNotice(null);
    void backend.open(session).catch((e: unknown) => setNotice(messageOf(e)));
  };

  const remove = async () => {
    if (!schedule) return;
    setDoomed(false);
    try {
      await backend.remove(schedule.id);
      onBack();
    } catch (e) {
      setNotice(messageOf(e));
    }
  };

  /** Back to the list, and Delete for a schedule that exists. */
  const head = (
    <div className="schedules-detail-head">
      <Button icon={<Icon name="arrow-left-line" size={13} />} onClick={onBack}>
        Back
      </Button>
      {schedule && (
        <Button
          variant="danger"
          icon={<Icon name="delete-bin-fill" size={13} />}
          onClick={() => setDoomed(true)}
        >
          Delete
        </Button>
      )}
    </div>
  );

  if (!listing) return null;
  if (!fresh && !schedule) {
    return (
      <div className="hs-scroll hs-settings-scroll schedules-fill schedules-detail">
        <div className="hs-settings-content">
          {head}
          <SettingsCard>
            <ListRow title="This schedule is gone." />
          </SettingsCard>
        </div>
      </div>
    );
  }

  const appOptions: Option[] = apps.map((a) => ({ value: a.id, label: a.name }));
  if (schedule && !apps.some((a) => a.id === schedule.app)) {
    appOptions.push({
      value: schedule.app,
      label: schedule.appName,
      sub: 'Not installed, not enabled, or without an agent',
      disabled: true,
    });
  }
  const effective = choices?.effective;
  const automatic: Option =
    effective && effective.card !== null
      ? {
          value: '',
          label: `Automatic (${choices?.models.find((m) => m.id === effective.card)?.name ?? effective.card})`,
        }
      : { value: '', label: 'Automatic', ...(effective && { sub: effective.reason }) };
  const modelOptions: Option[] = [
    automatic,
    ...(choices?.models ?? []).map((m) => ({ value: m.id, label: m.name })),
  ];
  const projects = choices?.projects ?? [];
  const projectOptions: Option[] = [
    { value: '', label: 'None' },
    ...projects.map((p) => ({ value: p.id, label: p.name })),
  ];
  const repeat = form.rhythm.repeat;
  const once = onceParts(form.rhythm.once);
  const runs = schedule ? listing.runs.filter((r) => r.schedule === schedule.id) : [];

  return (
    <div className="hs-scroll hs-settings-scroll schedules-fill schedules-detail">
      <div className="hs-settings-content">
        {head}
        <div className="schedules-fields">
          <span className="schedules-title-field">
            <TextInput
              value={form.title}
              placeholder="Title"
              aria-label="Title"
              onChange={(e) => edit({ title: e.target.value })}
            />
          </span>
          <textarea
            className="hs-in hs-ta schedules-prompt"
            value={form.prompt}
            placeholder="What the app is told each time it runs"
            aria-label="Prompt"
            onChange={(e) => edit({ prompt: e.target.value })}
          />
        </div>

        <SettingsSection>Details</SettingsSection>
        <SettingsCard>
          <InfoRow
            title="App"
            value={
              <SettingsSelect
                value={form.app}
                options={appOptions}
                placeholder="Pick an app"
                onPick={(app) => edit({ app, project: '', model: '' })}
              />
            }
          />
          {projects.length > 0 && (
            <InfoRow
              title="Project"
              value={
                <SettingsSelect
                  value={form.project}
                  options={projectOptions}
                  onPick={(project) => edit({ project })}
                />
              }
            />
          )}
          <InfoRow
            title="Model"
            value={
              <SettingsSelect
                value={form.model}
                options={modelOptions}
                onPick={(model) => edit({ model })}
              />
            }
          />
        </SettingsCard>

        <SettingsSection>Frequency</SettingsSection>
        <SettingsCard>
          <InfoRow
            title="Repeat"
            value={<SettingsSelect value={repeat} options={REPEATS} onPick={pickRepeat} />}
          />
          {repeat === 'weekly' && (
            <InfoRow
              title="On"
              value={
                <SettingsSelect
                  value={form.rhythm.on}
                  options={WEEKDAYS}
                  onPick={(on) => editRhythm({ on })}
                />
              }
            />
          )}
          {repeat === 'monthly' && (
            <InfoRow
              title="On"
              value={
                <SettingsSelect
                  value={form.rhythm.on}
                  options={MONTH_DAYS}
                  menuHeight={PICKER_HEIGHT}
                  onPick={(on) => editRhythm({ on })}
                />
              }
            />
          )}
          {repeat === 'once' && (
            <>
              <InfoRow
                title="On"
                value={
                  <SettingsSelect
                    value={once.date}
                    options={dateOptions(once.date)}
                    minWidth={150}
                    menuHeight={PICKER_HEIGHT}
                    onPick={(date) => editRhythm({ once: `${date}T${once.time}` })}
                  />
                }
              />
              <InfoRow
                title="At"
                value={
                  <SettingsSelect
                    value={once.time}
                    options={timeOptions(once.time)}
                    minWidth={90}
                    menuHeight={PICKER_HEIGHT}
                    onPick={(time) => editRhythm({ once: `${once.date}T${time}` })}
                  />
                }
              />
            </>
          )}
          {repeat === 'custom' && (
            <>
              <InfoRow
                title="When"
                {...(words && !words.ok && { sub: words.text })}
                value={
                  words === null ? (
                    'Not set yet'
                  ) : words.ok ? (
                    words.text
                  ) : (
                    <StatusWord tone="bad">Not a schedule</StatusWord>
                  )
                }
              />
              <button
                type="button"
                className="hs-setrow schedules-disclosure"
                aria-expanded={advanced}
                onClick={() => setAdvanced((open) => !open)}
              >
                <Icon name={advanced ? 'arrow-down-s-line' : 'arrow-right-s-line'} size={13} />
                Advanced
              </button>
              {advanced && (
                <InfoRow
                  title="Cron expression"
                  sub="Minute, hour, day of the month, month, day of the week"
                  value={
                    <TextInput
                      value={form.rhythm.cron}
                      placeholder="0 9 * * 1-5"
                      aria-label="Cron expression"
                      onChange={(e) => editRhythm({ cron: e.target.value })}
                    />
                  }
                />
              )}
            </>
          )}
          {repeat !== 'once' && repeat !== 'custom' && (
            <InfoRow
              title="At"
              value={
                <SettingsSelect
                  value={form.rhythm.at}
                  options={timeOptions(form.rhythm.at)}
                  minWidth={90}
                  menuHeight={PICKER_HEIGHT}
                  onPick={(at) => editRhythm({ at })}
                />
              }
            />
          )}
          <InfoRow
            title="Notifications"
            value={
              <SettingsSelect
                value={form.notify}
                options={NOTIFY}
                onPick={(notify) => edit({ notify })}
              />
            }
          />
        </SettingsCard>

        {notice && <Notice>{notice}</Notice>}
        {(fresh || dirty) && (
          <div className="hs-settings-management">
            <Button disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : fresh ? 'Create' : 'Save'}
            </Button>
          </div>
        )}

        {schedule && (
          <>
            <SettingsSection>Runs</SettingsSection>
            <SettingsCard>
              {runs.length === 0 && <ListRow title="Has not run yet." />}
              {runs.map((r) => {
                const how = outcome(r);
                const session = r.session;
                const row = {
                  mark: <StateDot tone={how.tone} />,
                  title: `${how.word} ${relative(r.startedAt)}`,
                  ...(r.error && { sub: r.error }),
                };
                return session ? (
                  <LinkRow key={r.id} {...row} onOpen={() => openRun(session)} />
                ) : (
                  <ListRow key={r.id} {...row} />
                );
              })}
            </SettingsCard>
          </>
        )}

        {doomed && schedule && (
          <ShellConfirm
            title={`Delete ${schedule.title}?`}
            body="It runs no more, and its record of runs goes with it. The conversations it started stay."
            action="Delete"
            onConfirm={() => void remove()}
            onCancel={() => setDoomed(false)}
          />
        )}
      </div>
    </div>
  );
}
