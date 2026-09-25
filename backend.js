'use strict';
/**
 * The Schedules app's backend: the timers of every scheduled run. A
 * schedule names an app, a cron expression or one instant, a prompt and
 * how to catch up; when it is due the backend starts a conversation in
 * that app with the prompt, keeps the run until the conversation's turn
 * ends, and tells the person as the schedule asks. The tools serve
 * agents over the bus; the invoke handlers serve the app's own page.
 * The service lifetime keeps the timers running with no window open.
 */

const TICK_MS = 15000;
/** How many runs each schedule keeps. */
const RUNS_KEPT = 50;
/** How far a cron search looks for the next match. */
const SEARCH_MINUTES = 366 * 24 * 60;

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

// ---- The record -------------------------------------------------------------

let ctx = null;
let state = { schedules: {}, runs: [], suggestions: [] };
let timer = null;
let sequence = 0;

const save = () => ctx.store.set('state', state);
const changed = async () => {
  await save();
  await ctx.events.emit({ name: 'changed', data: null, durable: false });
};

const shortId = () => `${Date.now().toString(36)}-${(sequence += 1).toString(36)}`;

/** The app a call came from: the first app on the chain that is not
 *  this one, else the app named. */
function callerOf(run, named) {
  if (typeof named === 'string' && named) return named;
  const from = run?.context?.chain?.find((p) => p.kind === 'app' && p.id !== ctx.app.id);
  if (!from) throw new Error('name the app the conversation starts in');
  return from.id;
}

function whenOf(s) {
  return s.once ? `once at ${s.once}` : `${s.spec} (${s.timezone})`;
}

/** One schedule as the model reads it. */
function describe(s) {
  const notes = [whenOf(s), `in ${s.app}`];
  if (!s.enabled) notes.push('off');
  if (s.spent) notes.push('already ran');
  if (s.running) notes.push('running now');
  if (s.nextRunAt && s.enabled && !s.spent) notes.push(`next ${s.nextRunAt}`);
  if (s.lastRunAt) notes.push(`last ${s.lastRunAt}`);
  return `${s.id} "${s.title}": ${notes.join(', ')}\n  ${s.prompt}`;
}

/** A draft checked into a record: the timing parsed, the zone known. */
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
    app,
    title,
    prompt,
    timezone,
    enabled: true,
    catchUp: draft.catchUp === 'once' ? 'once' : 'skip',
    notify: ['all', 'failures', 'none'].includes(draft.notify) ? draft.notify : 'all',
    createdAt: new Date().toISOString(),
  };
  if (draft.spec) {
    parseCron(draft.spec);
    s.spec = String(draft.spec).trim();
  } else {
    const at = new Date(String(draft.once));
    if (Number.isNaN(at.getTime())) throw new Error(`"${draft.once}" is not a date-time`);
    s.once = at.toISOString();
  }
  if (typeof draft.project === 'string' && draft.project) s.project = draft.project;
  if (typeof draft.model === 'string' && draft.model) s.model = draft.model;
  s.nextRunAt = nextOf(s, Date.now());
  return s;
}

function nextOf(s, from) {
  if (s.once) return Date.parse(s.once) > from ? s.once : null;
  return nextMatch(parseCron(s.spec), s.timezone, from);
}

// ---- Runs -------------------------------------------------------------------

function runsOf(id) {
  return state.runs.filter((r) => r.schedule === id);
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
      await ctx.notify({
        title: s.title,
        body: failed ? `The run ended: ${stopReason}.` : 'The run finished.',
        session,
      });
    }
  }
  await changed();
}

/** Starts the conversation a schedule asks for and records the run. */
async function fire(s, why) {
  if (s.running) return;
  s.running = true;
  s.lastRunAt = new Date().toISOString();
  if (s.once) s.spent = true;
  s.nextRunAt = s.once ? null : nextOf(s, Date.now());
  const run = { id: shortId(), schedule: s.id, startedAt: s.lastRunAt, why };
  try {
    const { id } = await ctx.sessions.create({
      app: s.app,
      title: `${s.title} · ${s.lastRunAt.slice(0, 16).replace('T', ' ')}`,
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
    s.running = false;
    run.finishedAt = new Date().toISOString();
    run.stopReason = 'refused';
    run.error = e.message;
    state.runs = [...state.runs, run];
    ctx.log('error', `${s.title} could not start in ${s.app}: ${e.message}`);
    if (s.notify !== 'none') {
      await ctx.notify({ title: s.title, body: `The run could not start: ${e.message}` });
    }
    await changed();
  }
}

/** Every due schedule fires; a window the computer slept through fires
 *  once or is skipped as the schedule says. */
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

module.exports = {
  async activate(app) {
    ctx = app;
    const held = await ctx.store.get('state');
    if (held && typeof held === 'object') state = { schedules: {}, runs: [], suggestions: [], ...held };
    for (const s of Object.values(state.schedules)) {
      if (!s.running && !s.spent) s.nextRunAt = s.nextRunAt ?? nextOf(s, Date.now());
    }
    ctx.sessions.on('finished', (r) => void finished(r.session, r.stopReason));
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
      const s = makeSchedule(input, callerOf(run, input.app));
      state.schedules[s.id] = s;
      await changed();
      return `Scheduled "${s.title}" ${whenOf(s)} in ${s.app} as ${s.id}. Nothing happens until it fires${s.nextRunAt ? `, next at ${s.nextRunAt}` : ''}.`;
    },
    async suggest(input, run) {
      const app = callerOf(run, input.app);
      const draft = makeSchedule({ ...input, spec: input.spec }, app);
      const suggestion = {
        id: draft.id,
        app,
        title: draft.title,
        prompt: draft.prompt,
        spec: draft.spec,
        timezone: draft.timezone,
        reason: String(input.reason ?? '').trim(),
        at: new Date().toISOString(),
      };
      state.suggestions.push(suggestion);
      await changed();
      return `Suggested "${suggestion.title}" ${whenOf(suggestion)}; it waits on the Schedules page for the person's approval.`;
    },
    async list() {
      const all = Object.values(state.schedules);
      return all.length ? all.map(describe).join('\n') : 'No schedules.';
    },
    async update(input) {
      const s = state.schedules[String(input.id)];
      if (!s) throw new Error(`no schedule ${input.id}`);
      if (typeof input.title === 'string' && input.title.trim()) s.title = input.title.trim();
      if (typeof input.prompt === 'string' && input.prompt.trim()) s.prompt = input.prompt.trim();
      if (typeof input.timezone === 'string' && input.timezone) s.timezone = checkZone(input.timezone);
      if (typeof input.spec === 'string' && input.spec) {
        parseCron(input.spec);
        s.spec = input.spec.trim();
        delete s.once;
        s.spent = false;
      }
      if (typeof input.enabled === 'boolean') s.enabled = input.enabled;
      s.nextRunAt = s.spent ? null : nextOf(s, Date.now());
      await changed();
      return `Changed ${s.id}: ${describe(s)}`;
    },
    async remove(input) {
      const s = state.schedules[String(input.id)];
      if (!s) throw new Error(`no schedule ${input.id}`);
      delete state.schedules[s.id];
      state.runs = state.runs.filter((r) => r.schedule !== s.id);
      await changed();
      return `Removed "${s.title}".`;
    },
  },
  invoke: {
    list: () => ({
      schedules: Object.values(state.schedules),
      runs: [...state.runs].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)),
      suggestions: state.suggestions,
      zone: localZone(),
    }),
    async apps() {
      const all = await ctx.apps.list();
      return all.filter((a) => a.agent && a.id !== ctx.app.id);
    },
    async choices({ app }) {
      const [models, projects] = await Promise.all([ctx.models.for(app), ctx.projects.list(app)]);
      return { models, projects };
    },
    async create({ draft }) {
      const s = makeSchedule(draft, String(draft.app));
      state.schedules[s.id] = s;
      await changed();
      return s;
    },
    async set({ id, patch }) {
      return module.exports.tools.update({ id, ...patch });
    },
    async remove({ id }) {
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
      const s = makeSchedule(sg, sg.app);
      state.schedules[s.id] = s;
      await changed();
      return s;
    },
    async dismiss({ id }) {
      state.suggestions = state.suggestions.filter((x) => x.id !== id);
      await changed();
      return null;
    },
  },
};
