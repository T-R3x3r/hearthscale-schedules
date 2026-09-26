/**
 * The main view: every schedule in one list, with filters, a search,
 * Create and the suggestions that wait for the person. A row opens its
 * schedule in the `schedule` panel; Completed lists the runs instead,
 * and a run opens its conversation.
 */
import { useCallback, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { RealmClient } from '@hearthscale/app';
import {
  anchorFrom,
  Button,
  Chip,
  CloseGlyph,
  DotsGlyph,
  IconButton,
  LinkRow,
  ListRow,
  MDivider,
  MenuSurface,
  MItem,
  Notice,
  PageTitle,
  PauseGlyph,
  PlayGlyph,
  PlusGlyph,
  RunGlyph,
  SettingsCard,
  SettingsSearch,
  SettingsSection,
  ShellConfirm,
  TrashGlyph,
  type MenuAnchor,
} from '@hearthscale/ui';
import {
  messageOf,
  newScheduleKey,
  type AppFacts,
  type Backend,
  type Listing,
  type Run,
  type Schedule,
  type Suggestion,
} from './client.ts';
import { AppMark, StateDot } from './marks.tsx';
import { outcome, relative, standing, useTick, type Tone } from './words.ts';

type Filter = 'all' | 'active' | 'paused' | 'completed';

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'paused', label: 'Paused' },
  { id: 'completed', label: 'Completed' },
];

const EMPTY: Record<Filter, string> = {
  all: 'No schedules yet.',
  active: 'No active schedules.',
  paused: 'No paused schedules.',
  completed: 'No runs yet.',
};

/** A row's title with the dot of its state before it. */
function Titled({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="schedules-title-line">
      <StateDot tone={tone} />
      <span className="schedules-title-text">{children}</span>
    </span>
  );
}

/** The overflow press at a row's end, shown while the row is hovered or
 *  its menu is open. */
function RowMenuPress({ open, onPress }: { open: boolean; onPress: (anchor: MenuAnchor) => void }) {
  return (
    <IconButton
      size="sm"
      aria-label="More"
      className="hs-rowact"
      data-open={open ? 'true' : 'false'}
      onClick={(e) => {
        e.stopPropagation();
        onPress(anchorFrom('row', e));
      }}
    >
      <DotsGlyph size={16} />
    </IconButton>
  );
}

/** A card whose whole face opens something. */
function PressCard({ onPress, children }: { onPress: () => void; children: ReactNode }) {
  const onKey = (e: KeyboardEvent) => {
    if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onPress();
    }
  };
  return (
    <SettingsCard>
      <div
        className="schedules-press hs-hovbox"
        role="button"
        tabIndex={0}
        onClick={onPress}
        onKeyDown={onKey}
      >
        {children}
      </div>
    </SettingsCard>
  );
}

type Menu = { kind: 'schedule' | 'suggestion'; id: string; anchor: MenuAnchor };

export function List({ backend, client }: { backend: Backend; client: RealmClient }) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [apps, setApps] = useState<AppFacts[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [doomed, setDoomed] = useState<Schedule | null>(null);
  useTick();

  const load = useCallback(() => {
    void Promise.all([backend.list(), backend.apps()])
      .then(([next, candidates]) => {
        setListing(next);
        setApps(candidates);
      })
      .catch((e: unknown) => setNotice(messageOf(e)));
  }, [backend]);
  useEffect(() => {
    load();
    return client.events('changed', load);
  }, [client, load]);

  /** One write, whose refusal is the notice. */
  const act = (run: () => Promise<void>) => {
    setMenu(null);
    setNotice(null);
    void run()
      .then(load)
      .catch((e: unknown) => setNotice(messageOf(e)));
  };

  const appOf = (id: string) => apps.find((a) => a.id === id);
  const q = query.trim().toLowerCase();
  const matches = (x: { title: string; appName: string; prompt: string }) =>
    !q || [x.title, x.appName, x.prompt].some((text) => text.toLowerCase().includes(q));

  const schedules = (listing?.schedules ?? []).filter((s) => {
    if (!matches(s)) return false;
    if (filter === 'active') return s.enabled && !s.spent;
    if (filter === 'paused') return !s.enabled && !s.spent;
    return true;
  });
  const byId = new Map((listing?.schedules ?? []).map((s) => [s.id, s]));
  const runs = (listing?.runs ?? []).filter((r) => {
    const s = byId.get(r.schedule);
    return s !== undefined && matches(s);
  });
  const suggestions = (listing?.suggestions ?? []).filter((g) => matches(g));

  const open = (s: Schedule) =>
    void client.panels.open({ id: 'schedule', key: s.id, title: s.title });
  const create = () =>
    void client.panels.open({ id: 'schedule', key: newScheduleKey(), title: 'New schedule' });
  const toggleMenu = (kind: Menu['kind'], id: string, anchor: MenuAnchor) =>
    setMenu((m) => (m?.id === id ? null : { kind, id, anchor }));

  const scheduleRow = (s: Schedule) => {
    const state = standing(s);
    return (
      <PressCard key={s.id} onPress={() => open(s)}>
        <ListRow
          mark={<AppMark app={appOf(s.app)} />}
          title={<Titled tone={state.tone}>{s.title}</Titled>}
          sub={
            <span className="schedules-facts">
              <span>
                {s.words}, in {s.appName}
              </span>
              <span>{state.words}</span>
            </span>
          }
          actions={
            <RowMenuPress
              open={menu?.id === s.id}
              onPress={(anchor) => toggleMenu('schedule', s.id, anchor)}
            />
          }
        />
      </PressCard>
    );
  };

  const runRow = (r: Run) => {
    const s = byId.get(r.schedule)!;
    const how = outcome(r);
    const session = r.session;
    const row = {
      mark: <AppMark app={appOf(s.app)} />,
      title: <Titled tone={how.tone}>{s.title}</Titled>,
      sub: (
        <span className="schedules-facts">
          <span>
            {how.word} {relative(r.startedAt)}
          </span>
          {r.error && <span>{r.error}</span>}
        </span>
      ),
    };
    return (
      <SettingsCard key={r.id}>
        {session ? (
          <LinkRow {...row} onOpen={() => void client.open({ session })} />
        ) : (
          <ListRow {...row} />
        )}
      </SettingsCard>
    );
  };

  const suggestionRow = (g: Suggestion) => (
    <SettingsCard key={g.id}>
      <ListRow
        mark={<AppMark app={appOf(g.app)} />}
        title={
          <span className="schedules-title-line">
            <span className="schedules-title-text">{g.title}</span>
            <span className="schedules-aside">
              {g.words}, in {g.appName}
            </span>
          </span>
        }
        sub={g.reason}
        actions={
          <>
            <Button onClick={() => act(() => backend.approve(g.id))}>Add</Button>
            <RowMenuPress
              open={menu?.id === g.id}
              onPress={(anchor) => toggleMenu('suggestion', g.id, anchor)}
            />
          </>
        }
      />
    </SettingsCard>
  );

  const menuSchedule = menu?.kind === 'schedule' ? byId.get(menu.id) : undefined;
  const menuSuggestion =
    menu?.kind === 'suggestion' ? listing?.suggestions.find((g) => g.id === menu.id) : undefined;
  const shown = filter === 'completed' ? runs.length : schedules.length;

  return (
    <div className="hs-scroll hs-settings-scroll schedules-fill">
      <div className="schedules-page">
        <div className="schedules-heading">
          <PageTitle lead="Ask an app to schedule tasks, set reminders or watch for changes.">
            Scheduled tasks
          </PageTitle>
        </div>
        <span className="schedules-create">
          <Button icon={<PlusGlyph size={13} />} onClick={create}>
            Create
          </Button>
        </span>
        <div className="schedules-search">
          <SettingsSearch value={query} placeholder="Search scheduled tasks" onChange={setQuery} />
        </div>
        <div className="schedules-filters">
          {FILTERS.map((f) => (
            <Chip key={f.id} selected={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </Chip>
          ))}
        </div>
        <div className="schedules-body">
          {notice && <Notice>{notice}</Notice>}
          <div className="schedules-list">
            {listing && shown === 0 && (
              <SettingsCard>
                <ListRow
                  title={q ? 'Nothing matches.' : EMPTY[filter]}
                  {...(!q &&
                    filter === 'all' && {
                      sub: 'Create one here, or ask an app for one in a conversation.',
                    })}
                />
              </SettingsCard>
            )}
            {filter === 'completed' ? runs.map(runRow) : schedules.map(scheduleRow)}
          </div>
          {filter !== 'completed' && suggestions.length > 0 && (
            <>
              <SettingsSection>Suggestions</SettingsSection>
              <div className="schedules-list">{suggestions.map(suggestionRow)}</div>
            </>
          )}
        </div>
      </div>
      {menu && menuSchedule && (
        <MenuSurface keyboard anchor={menu.anchor} align="right" onDismiss={() => setMenu(null)}>
          <MItem
            icon={<RunGlyph size={14} />}
            label="Run now"
            disabled={menuSchedule.running === true}
            onClick={() => act(() => backend.runNow(menuSchedule.id))}
          />
          {!menuSchedule.spent &&
            (menuSchedule.enabled ? (
              <MItem
                icon={<PauseGlyph size={14} />}
                label="Pause"
                onClick={() => act(() => backend.set(menuSchedule.id, { enabled: false }))}
              />
            ) : (
              <MItem
                icon={<PlayGlyph size={14} />}
                label="Resume"
                onClick={() => act(() => backend.set(menuSchedule.id, { enabled: true }))}
              />
            ))}
          <MDivider />
          <MItem
            danger
            icon={<TrashGlyph size={14} />}
            label="Delete"
            onClick={() => {
              setMenu(null);
              setDoomed(menuSchedule);
            }}
          />
        </MenuSurface>
      )}
      {menu && menuSuggestion && (
        <MenuSurface keyboard anchor={menu.anchor} align="right" onDismiss={() => setMenu(null)}>
          <MItem
            icon={<CloseGlyph size={14} />}
            label="Dismiss"
            onClick={() => act(() => backend.dismiss(menuSuggestion.id))}
          />
        </MenuSurface>
      )}
      {doomed && (
        <ShellConfirm
          title={`Delete ${doomed.title}?`}
          body="It runs no more, and its record of runs goes with it. The conversations it started stay."
          action="Delete"
          onConfirm={() => {
            const s = doomed;
            setDoomed(null);
            act(() => backend.remove(s.id));
          }}
          onCancel={() => setDoomed(null)}
        />
      )}
    </div>
  );
}
