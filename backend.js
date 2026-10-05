'use strict';
/**
 * The Schedules app's backend: the timers of every scheduled run. A
 * schedule names an app, a cron expression or one instant, a prompt and
 * how to catch up; when it is due the backend starts a conversation in
 * that app with the prompt, keeps the run until the conversation's turn
 * ends, and tells the person as the schedule asks. Five tools serve
 * agents over the bus; the others serve the app's own view alone.
 * Once a day and whenever the set of apps changes, it asks the model for
 * recurring tasks worth suggesting. The service lifetime keeps the timers
 * running with no window open.
 */

const TICK_MS = 15000;
/** How many runs each schedule keeps. */
const RUNS_KEPT = 50;
/** How far a cron search looks for the next match. */
const SEARCH_MINUTES = 366 * 24 * 60;
/** How often the backend asks for suggestions of its own. */
const SUGGEST_EVERY_MS = 24 * 60 * 60 * 1000;
/** The most suggestions one ask adds. */
const SUGGEST_MAX = 3;
/** The most characters of a run's answer a notification carries. */
const NOTICE_CHARS = 180;

// ---- Cron -----------------------------------------------------------------

/** One field of a five-field expression as the set of values it admits. */
function field(text, min, max, names) {
  const admits = new Set();
  for (const part of text.split(',')) {
    const [rangeText, stepText] = part.split('/');
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad step in "${part}"`);
    let lo;
    let hi;
    if (rangeText === '*') {
      lo = min;
      hi = max;
    } else {
      const [a, b] = rangeText.split('-');
      const read = (v) => {
        const named = names?.indexOf(v.toLowerCase());
        const n = named !== undefined && named >= 0 ? named + min : Number(v);
        if (!Number.isInteger(n) || n < min || n > max) throw new Error(`"${v}" is outside ${min}-${max}`);
        return n;
      };
      lo = read(a);
      hi = b === undefined ? (stepText === undefined ? lo : max) : read(b);
    }
    for (let v = lo; v <= hi; v += step) admits.add(v);
  }
  return admits;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The five sets an expression admits. Throws on an expression that is
 *  not five fields of minutes, hours, days, months and weekdays. */
function parseCron(spec) {
  const parts = String(spec).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error('a cron expression has five fields');
  const days = field(parts[4].replace(/7/g, '0'), 0, 6, DAYS);
  return {
    minutes: field(parts[0], 0, 59),
    hours: field(parts[1], 0, 23),
    dates: field(parts[2], 1, 31),
    months: field(parts[3], 1, 12, MONTHS),
    days,
    anyDate: parts[2] === '*',
    anyDay: parts[4] === '*',
  };
}

/** The wall-clock fields of an instant in a zone. */
function fieldsIn(zone, at) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short',
  }).formatToParts(at);
  const get = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    minute: Number(get('minute')),
    hour: Number(get('hour')) % 24,
    date: Number(get('day')),
    month: Number(get('month')),
    day: DAYS.indexOf(get('weekday').toLowerCase()),
  };
}

/** The first minute after `from` the expression matches in the zone, as
 *  an instant, or null within a year. */
function nextMatch(cron, zone, from) {
  const start = new Date(from);
  start.setUTCSeconds(0, 0);
  for (let i = 1; i <= SEARCH_MINUTES; i += 1) {
    const at = new Date(start.getTime() + i * 60000);
    const f = fieldsIn(zone, at);
    if (!cron.minutes.has(f.minute) || !cron.hours.has(f.hour) || !cron.months.has(f.month)) continue;
    // Standard cron: with both a date and a weekday named, either matches.
    const dateOk = cron.dates.has(f.date);
    const dayOk = cron.days.has(f.day);
    const okay = cron.anyDate ? dayOk : cron.anyDay ? dateOk : dateOk || dayOk;
    if (okay) return at.toISOString();
  }
  return null;
}

function checkZone(zone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
  } catch {
    throw new Error(`"${zone}" is not a timezone name`);
  }
  return zone;
}

const localZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// ---- Words ------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, '0');

/** An instant as a person reads it in a zone: "25 Sept 2026, 14:04". */
function stamp(iso, zone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

/** When an instant falls, from now, in a zone: "today at 15:00",
 *  "tomorrow at 09:00", or "on 27 Sept 2026, 09:00". */
function nextWords(iso, zone) {
  const at = fieldsIn(zone, new Date(iso));
  const now = fieldsIn(zone, new Date());
  const tomorrow = fieldsIn(zone, new Date(Date.now() + 24 * 60 * 60 * 1000));
  const same = (a, b) => a.year === b.year && a.month === b.month && a.date === b.date;
  const time = `${pad(at.hour)}:${pad(at.minute)}`;
  if (same(at, now)) return `today at ${time}`;
  if (same(at, tomorrow)) return `tomorrow at ${time}`;
  return `on ${stamp(iso, zone)}`;
}

/** A schedule's rhythm in the words a person reads. */
function rhythmWords(s) {
  if (s.once) return `once, ${stamp(s.once, s.timezone)}`;
  const [m, h, dom, mon, dow] = s.spec.split(/\s+/);
  const num = (v) => /^\d+$/.test(v);
  const every = (v) => /^\*\/\d+$/.test(v);
  const at = num(m) && num(h) ? ` at ${pad(h)}:${pad(m)}` : '';
  const anyDay = dom === '*' && mon === '*' && dow === '*';
  if (m === '*' && h === '*' && anyDay) return 'every minute';
  if (every(m) && h === '*' && anyDay) return `every ${m.slice(2)} minutes`;
  if (num(m) && h === '*' && anyDay) return `every hour at minute ${Number(m)}`;
  if (num(m) && every(h) && anyDay) return `every ${h.slice(2)} hours at minute ${Number(m)}`;
  if (anyDay && at) return `every day${at}`;
  if (dom === '*' && mon === '*' && dow === '1-5' && at) return `every weekday${at}`;
  if (dom === '*' && mon === '*' && /^[0-7]$/.test(dow) && at) {
    return `every ${DAY_NAMES[Number(dow) % 7]}${at}`;
  }
  if (every(dom) && mon === '*' && dow === '*' && at) return `every ${dom.slice(2)} days${at}`;
  if (num(dom) && mon === '*' && dow === '*' && at) return `every month on day ${dom}${at}`;
  return 'on a custom rhythm';
}

const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

// ---- The record -------------------------------------------------------------

let ctx = null;
let state = { schedules: {}, runs: [], suggestions: [], dismissed: [], suggestedAt: null };
let timer = null;
let sequence = 0;
let suggesting = false;

const save = () => ctx.store.set('state', state);
const changed = async () => {
  await save();
  await ctx.events.emit({ name: 'changed', data: null, durable: false });
};

const shortId = () => `${Date.now().toString(36)}-${(sequence += 1).toString(36)}`;

/** The apps a schedule may run in: every enabled app with an agent. */
async function candidates() {
  return (await ctx.apps.list()).filter((a) => a.agent && a.id !== ctx.app.id);
}

const choicesWords = (apps) =>
  apps.length ? apps.map((a) => `${a.id} (${a.name})`).join(', ') : 'none is installed';

/**
 * The app a schedule runs in. A name matches an app's id, else its display
 * name ignoring case; no name is the first app on the call chain that is a
 * candidate. Anything else is refused with the choices, so the calling
 * model can retry.
 */
async function resolveApp(run, named) {
  const apps = await candidates();
  if (typeof named === 'string' && named.trim()) {
    const want = named.trim();
    const hit =
      apps.find((a) => a.id === want) ??
      apps.find((a) => a.name.toLowerCase() === want.toLowerCase());
    if (!hit) {
      throw new Error(
        `no installed app with an agent is called "${want}"; the choices are: ${choicesWords(apps)}. Leave app out to run in your own app.`,
      );
    }
    return hit;
  }
  const chain = run?.context?.chain ?? [];
  const from = chain.find((p) => p.kind === 'app' && apps.some((a) => a.id === p.id));
  if (!from) {
    throw new Error(
      `Name the app the conversation starts in; the choices are: ${choicesWords(apps)}.`,
    );
  }
  return apps.find((a) => a.id === from.id);
}

/** The display name of the app a record names: the app's own while it is
 *  enabled, else the name the record kept when it was made. */
async function appNames() {
  const names = new Map((await ctx.apps.list()).map((a) => [a.id, a.name]));
  return (record) => names.get(record.app) ?? record.appName;
}

/** One schedule in words: the rhythm, the app, and the next run. */
function scheduleWords(s, nameOf) {
  const next =
    s.enabled && !s.spent && s.nextRunAt ? ` Next run ${nextWords(s.nextRunAt, s.timezone)}.` : '';
  return `"${s.title}" ${rhythmWords(s)}, in ${nameOf(s)}.${next}`;
}

/** One schedule as the model reads it. */
function describe(s, nameOf) {
  const notes = [];
  if (!s.enabled) notes.push(s.offReason ? `off: ${s.offReason}` : 'off');
  if (s.spent) notes.push('already ran');
  if (s.running) notes.push('running now');
  if (s.lastRunAt) notes.push(`last ran ${stamp(s.lastRunAt, s.timezone)}`);
  const spec = s.spec ? ` Cron "${s.spec}" in ${s.timezone}.` : '';
  return `${s.id}: ${scheduleWords(s, nameOf)}${spec}${notes.length ? ` ${capital(notes.join(', '))}.` : ''}\n  ${s.prompt}`;
}

/** A draft checked into a record for an app, `{ id, name }`: the timing
 *  parsed, the zone known. */
function makeSchedule(draft, app) {
  const title = String(draft.title ?? '').trim();
  const prompt = String(draft.prompt ?? '').trim();
  if (!title) throw new Error('a schedule needs a title');
  if (!prompt) throw new Error('a schedule needs a prompt');
  if (draft.spec && draft.once) throw new Error('name spec or once, never both');
  if (!draft.spec && !draft.once) throw new Error('name spec or once');
  const timezone = checkZone(draft.timezone ? String(draft.timezone) : localZone());
  const s = {
    id: shortId(),
    app: app.id,
    appName: app.name,
    title,
    prompt,
    timezone,
    enabled: true,
    catchUp: draft.catchUp === 'once' ? 'once' : 'skip',
    notify: ['all', 'failures', 'none'].includes(draft.notify) ? draft.notify : 'all',
    createdAt: new Date().toISOString(),
  };
  setTiming(s, draft);
  if (typeof draft.project === 'string' && draft.project) s.project = draft.project;
  if (typeof draft.model === 'string' && draft.model) s.model = draft.model;
  s.nextRunAt = nextOf(s, Date.now());
  return s;
}

/** A spec or one instant, checked, in place of the schedule's timing. */
function setTiming(s, draft) {
  if (draft.spec) {
    parseCron(draft.spec);
    s.spec = String(draft.spec).trim();
    delete s.once;
  } else {
    const at = new Date(String(draft.once));
    if (Number.isNaN(at.getTime())) throw new Error(`"${draft.once}" is not a date-time`);
    s.once = at.toISOString();
    delete s.spec;
  }
  s.spent = false;
}

function nextOf(s, from) {
  if (s.once) return Date.parse(s.once) > from ? s.once : null;
  return nextMatch(parseCron(s.spec), s.timezone, from);
}

// ---- Runs -------------------------------------------------------------------

function runsOf(id) {
  return state.runs.filter((r) => r.schedule === id);
}

/** The text of the last reply in a conversation, cut for a notification. */
async function answerOf(session) {
  const opened = await ctx.sessions.open(session);
  const reply = [...opened.entries]
    .reverse()
    .find((e) => e.type === 'agent.message' && e.parts.some((p) => p.kind === 'text' && p.text.trim()));
  if (!reply) return '';
  const text = reply.parts
    .filter((p) => p.kind === 'text')
    .map((p) => p.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > NOTICE_CHARS ? `${text.slice(0, NOTICE_CHARS - 1)}…` : text;
}

async function finished(session, stopReason) {
  const run = state.runs.find((r) => r.session === session && !r.finishedAt);
  if (!run) return;
  run.finishedAt = new Date().toISOString();
  run.stopReason = stopReason;
  const s = state.schedules[run.schedule];
  if (s) {
    s.running = false;
    const failed = stopReason !== 'end_turn';
    if (s.notify === 'all' || (s.notify === 'failures' && failed)) {
      const answer = await answerOf(session).catch(() => '');
      await ctx.notify({
        title: s.title,
        body: failed
          ? `The run ended early (${stopReason}).${answer ? ` ${answer}` : ''}`
          : answer || 'The run finished with no answer.',
        session,
      });
    }
  }
  await changed();
}

/** A run that could not start: recorded as failed, told once. */
async function failedToStart(s, run, reason) {
  s.running = false;
  run.finishedAt = new Date().toISOString();
  run.stopReason = 'refused';
  run.error = reason;
  state.runs = [...state.runs, run];
  ctx.log('error', `${s.title} could not start in ${s.app}: ${reason}`);
  if (s.notify !== 'none') {
    await ctx.notify({ title: s.title, body: `The run could not start: ${reason}` });
  }
  await changed();
}

/** Starts the conversation a schedule asks for and records the run. A
 *  schedule whose app is gone or off is switched off with the reason. */
async function fire(s, why) {
  if (s.running) return;
  s.running = true;
  s.lastRunAt = new Date().toISOString();
  if (s.once) s.spent = true;
  s.nextRunAt = s.once ? null : nextOf(s, Date.now());
  const run = { id: shortId(), schedule: s.id, startedAt: s.lastRunAt, why };
  if (!(await candidates()).some((a) => a.id === s.app)) {
    s.enabled = false;
    s.offReason = `${s.appName} is not installed, not enabled, or has no agent`;
    await failedToStart(s, run, `${s.offReason}; the schedule is switched off`);
    return;
  }
  try {
    const { id } = await ctx.sessions.create({
      app: s.app,
      title: `${s.title}, ${stamp(s.lastRunAt, s.timezone)}`,
      message: s.prompt,
      ...(s.project && { project: s.project }),
      ...(s.model && { model: s.model }),
    });
    run.session = id;
    state.runs = [...runsOf(s.id).slice(-(RUNS_KEPT - 1)), run, ...state.runs.filter((r) => r.schedule !== s.id)];
    await changed();
    ctx.sessions
      .wait(id)
      .then((end) => finished(id, end.stopReason))
      .catch((e) => ctx.log('warn', `wait on ${id} failed: ${e.message}`));
  } catch (e) {
    await failedToStart(s, run, e.message);
  }
}

/** Every due schedule fires; a window the computer slept through fires
 *  once or is skipped as the schedule says. A day after the last ask for
 *  suggestions, another one runs. */
async function tick() {
  const now = Date.now();
  for (const s of Object.values(state.schedules)) {
    if (!s.enabled || s.spent || s.running || !s.nextRunAt) continue;
    const due = Date.parse(s.nextRunAt);
    if (due > now) continue;
    const missed = now - due > 2 * TICK_MS;
    if (missed && s.catchUp === 'skip') {
      s.nextRunAt = nextOf(s, now);
      await changed();
      continue;
    }
    await fire(s, missed ? 'catch-up' : 'due');
  }
  if (!state.suggestedAt || now - Date.parse(state.suggestedAt) > SUGGEST_EVERY_MS) {
    void suggestOwn().catch((e) => ctx.log('warn', `no suggestions: ${e.message}`));
  }
}

/** Runs started before this activation and still listed are waited on,
 *  never started again; one no longer listed is closed as gone. */
async function reconcile() {
  const open = state.runs.filter((r) => r.session && !r.finishedAt);
  if (open.length === 0) return;
  const listed = await ctx.sessions.list();
  for (const run of open) {
    if (listed.some((x) => x.id === run.session)) {
      ctx.log('info', `reconciled run ${run.session}: waiting`);
      ctx.sessions
        .wait(run.session)
        .then((end) => finished(run.session, end.stopReason))
        .catch((e) => ctx.log('warn', `wait on ${run.session} failed: ${e.message}`));
    } else {
      run.finishedAt = new Date().toISOString();
      run.stopReason = 'gone';
      const s = state.schedules[run.schedule];
      if (s) s.running = false;
    }
  }
  await changed();
}

// ---- Suggestions of its own -------------------------------------------------

const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      maxItems: SUGGEST_MAX,
      items: {
        type: 'object',
        properties: {
          app: { type: 'string' },
          title: { type: 'string' },
          prompt: { type: 'string' },
          spec: { type: 'string' },
          reason: { type: 'string' },
        },
        required: ['app', 'title', 'prompt', 'spec', 'reason'],
      },
    },
  },
  required: ['suggestions'],
};

/** The key a suggestion is known by, so a dismissed one never returns. */
const keyOf = (app, title) => `${app}:${String(title).trim().toLowerCase()}`;

/**
 * Asks the model for up to three recurring tasks worth having in the apps
 * with an agent, given what each app says it does and what is scheduled
 * already. Each answer waits as a suggestion; one the person dismissed,
 * one already scheduled or suggested, and one that does not parse are
 * left out.
 */
async function suggestOwn() {
  if (suggesting) return;
  suggesting = true;
  try {
    state.suggestedAt = new Date().toISOString();
    await save();
    const apps = await candidates();
    if (apps.length === 0) return;
    const taken = new Set([
      ...Object.values(state.schedules).map((s) => keyOf(s.app, s.title)),
      ...state.suggestions.map((g) => keyOf(g.app, g.title)),
      ...state.dismissed,
    ]);
    const request = [
      'The apps on this computer that hold conversations:',
      ...apps.map((a) => `- ${a.id}: ${a.name}. ${a.description}`),
      '',
      'Already scheduled or turned down:',
      ...(taken.size > 0 ? [...taken].map((k) => `- ${k}`) : ['- nothing']),
      '',
      `Suggest up to ${SUGGEST_MAX} recurring tasks a person would want, each for one of these apps: its id as app, a title of a few words, the prompt the app is told when it runs, a five-field cron expression as spec, and the reason in one sentence. Suggest nothing that repeats what is listed above.`,
    ].join('\n');
    let raw = '';
    for await (const delta of ctx.models.complete({
      messages: [
        { role: 'system', content: 'You suggest useful recurring tasks for a person\'s apps.' },
        { role: 'user', content: request },
      ],
      format: { name: 'suggestions', schema: SUGGESTION_SCHEMA },
      reasoning: 'none',
    })) {
      if ('done' in delta) {
        if (delta.error) throw new Error(delta.error);
        break;
      }
      if (!delta.reasoning) raw += delta.text;
    }
    const answer = JSON.parse(raw.trim());
    let added = 0;
    for (const g of answer.suggestions ?? []) {
      const app = apps.find((a) => a.id === g.app);
      if (!app || taken.has(keyOf(g.app, g.title)) || added >= SUGGEST_MAX) continue;
      let draft;
      try {
        draft = makeSchedule({ title: g.title, prompt: g.prompt, spec: g.spec }, app);
      } catch {
        continue;
      }
      state.suggestions.push({
        id: draft.id,
        app: app.id,
        appName: app.name,
        title: draft.title,
        prompt: draft.prompt,
        spec: draft.spec,
        timezone: draft.timezone,
        reason: String(g.reason ?? '').trim(),
        at: new Date().toISOString(),
      });
      taken.add(keyOf(app.id, draft.title));
      added += 1;
    }
    ctx.log('info', `suggested ${added} schedules`);
    if (added > 0) await changed();
  } finally {
    suggesting = false;
  }
}

// ---- The view ---------------------------------------------------------------

/** A schedule as the view draws it: the record with its words. */
function shown(s, nameOf) {
  return { ...s, words: capital(rhythmWords(s)), appName: nameOf(s) };
}

/** Applies the fields a patch gives; the rest stay. */
async function patch(s, input) {
  if (typeof input.title === 'string' && input.title.trim()) s.title = input.title.trim();
  if (typeof input.prompt === 'string' && input.prompt.trim()) s.prompt = input.prompt.trim();
  if (typeof input.app === 'string' && input.app) {
    const app = await resolveApp(null, input.app);
    s.app = app.id;
    s.appName = app.name;
  }
  if (typeof input.timezone === 'string' && input.timezone) s.timezone = checkZone(input.timezone);
  if ((typeof input.spec === 'string' && input.spec) || (typeof input.once === 'string' && input.once)) {
    setTiming(s, input);
  }
  if (['all', 'failures', 'none'].includes(input.notify)) s.notify = input.notify;
  if (typeof input.model === 'string') {
    if (input.model) s.model = input.model;
    else delete s.model;
  }
  if (typeof input.project === 'string') {
    if (input.project) s.project = input.project;
    else delete s.project;
  }
  if (typeof input.enabled === 'boolean') {
    s.enabled = input.enabled;
    if (input.enabled) delete s.offReason;
  }
  s.nextRunAt = s.spent ? null : nextOf(s, Date.now());
}

module.exports = {
  async activate(app) {
    ctx = app;
    const held = await ctx.store.get('state');
    if (held && typeof held === 'object') state = { ...state, ...held };
    for (const s of Object.values(state.schedules)) {
      if (!s.running && !s.spent) s.nextRunAt = s.nextRunAt ?? nextOf(s, Date.now());
    }
    ctx.sessions.on('finished', (r) => void finished(r.session, r.stopReason));
    ctx.apps.on('changed', () =>
      void suggestOwn().catch((e) => ctx.log('warn', `no suggestions: ${e.message}`)),
    );
    await reconcile();
    timer = setInterval(() => void tick().catch((e) => ctx.log('error', e.message)), TICK_MS);
    await tick();
    ctx.log('info', `service up with ${Object.keys(state.schedules).length} schedules`);
  },
  deactivate() {
    if (timer) clearInterval(timer);
  },
  tools: {
    async create(input, run) {
      const app = await resolveApp(run, input.app);
      const s = makeSchedule(input, app);
      state.schedules[s.id] = s;
      await changed();
      return `Scheduled ${scheduleWords(s, await appNames())} Its id is ${s.id}.`;
    },
    async suggest(input, run) {
      const app = await resolveApp(run, input.app);
      const draft = makeSchedule(input, app);
      const suggestion = {
        id: draft.id,
        app: app.id,
        appName: app.name,
        title: draft.title,
        prompt: draft.prompt,
        spec: draft.spec,
        timezone: draft.timezone,
        reason: String(input.reason ?? '').trim(),
        at: new Date().toISOString(),
      };
      state.suggestions.push(suggestion);
      await changed();
      return `Suggested ${scheduleWords(draft, await appNames())} It waits on the Schedules page for the person's approval.`;
    },
    async list() {
      const all = Object.values(state.schedules);
      if (all.length === 0) return 'No schedules.';
      const nameOf = await appNames();
      return all.map((s) => describe(s, nameOf)).join('\n');
    },
    async update(input) {
      const s = state.schedules[String(input.id)];
      if (!s) throw new Error(`no schedule ${input.id}`);
      await patch(s, input);
      await changed();
      return `Changed ${s.id}: ${scheduleWords(s, await appNames())}`;
    },
    async remove(input) {
      const s = state.schedules[String(input.id)];
      if (!s) throw new Error(`no schedule ${input.id}`);
      delete state.schedules[s.id];
      state.runs = state.runs.filter((r) => r.schedule !== s.id);
      await changed();
      return `Removed "${s.title}".`;
    },
    async listing() {
      const nameOf = await appNames();
      return {
        schedules: Object.values(state.schedules).map((s) => shown(s, nameOf)),
        runs: [...state.runs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
        suggestions: state.suggestions.map((g) => shown(g, nameOf)),
        zone: localZone(),
      };
    },
    async apps() {
      return { apps: await candidates() };
    },
    async choices({ app }) {
      const [models, projects, effective] = await Promise.all([
        ctx.models.for(app),
        ctx.projects.list(app),
        ctx.models.effective('chat', app),
      ]);
      return { models, projects, effective };
    },
    /** An expression's rhythm in words, for a form that edits one; one
     *  that does not parse is refused with the reason. */
    async words({ spec }) {
      parseCron(spec);
      return capital(rhythmWords({ spec: String(spec).trim() }));
    },
    async add({ draft }) {
      const app = await resolveApp(null, draft.app);
      const s = makeSchedule(draft, app);
      state.schedules[s.id] = s;
      await changed();
      return s;
    },
    async set({ id, patch: fields }) {
      const s = state.schedules[String(id)];
      if (!s) throw new Error(`no schedule ${id}`);
      await patch(s, fields);
      await changed();
      return s;
    },
    async delete({ id }) {
      return module.exports.tools.remove({ id });
    },
    async runNow({ id }) {
      const s = state.schedules[id];
      if (!s) throw new Error(`no schedule ${id}`);
      await fire(s, 'by hand');
      return null;
    },
    async approve({ id }) {
      const i = state.suggestions.findIndex((x) => x.id === id);
      if (i < 0) throw new Error('no such suggestion');
      const [sg] = state.suggestions.splice(i, 1);
      const s = makeSchedule(sg, { id: sg.app, name: sg.appName });
      state.schedules[s.id] = s;
      await changed();
      return s;
    },
    async dismiss({ id }) {
      const sg = state.suggestions.find((x) => x.id === id);
      state.suggestions = state.suggestions.filter((x) => x.id !== id);
      if (sg) state.dismissed = [...new Set([...state.dismissed, keyOf(sg.app, sg.title)])];
      await changed();
      return null;
    },
  },
};
