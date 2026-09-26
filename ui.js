/**
 * The Schedules page: every schedule with its rhythm, the runs it made,
 * the suggestions other apps handed over, and a form for a new one.
 * Plain DOM on the design system's classes; the backend answers every
 * call, and the page redraws on its `changed` event.
 */
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const esc = (text) =>
  String(text ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/** The expression a form's repeat, day and time make. */
function specOf(repeat, on, at, custom) {
  const [h, m] = at.split(':').map(Number);
  switch (repeat) {
    case 'daily':
      return `${m} ${h} * * *`;
    case 'weekdays':
      return `${m} ${h} * * 1-5`;
    case 'weekly':
      return `${m} ${h} * * ${DAYS.indexOf(on)}`;
    case 'monthly':
      return `${m} ${h} ${Number(on) || 1} * *`;
    default:
      return custom;
  }
}

const when = (iso) => (iso ? new Date(iso).toLocaleString() : '');

export default function activate(client) {
  client.view((element) => {
    let listing = { schedules: [], runs: [], suggestions: [], zone: '' };
    let apps = [];
    let choices = { models: [], projects: [], effective: null };
    let notice = '';
    const form = { app: '', title: '', prompt: '', repeat: 'daily', on: 'Monday', at: '09:00', custom: '', once: '', model: '', project: '', notify: 'all' };

    const draw = () => {
      const scheduleRows = listing.schedules
        .map(
          (s) => `
          <div class="hs-setrow" style="display:flex;flex-direction:column;gap:4px;padding:10px 14px" data-id="${esc(s.id)}">
            <div style="display:flex;align-items:center;gap:10px">
              <strong style="flex:1">${esc(s.title)}</strong>
              <span style="color:var(--mut);font-size:var(--fs-sm)">${esc(s.words)}, in ${esc(s.appName)}${s.enabled ? '' : `, off${s.offReason ? `: ${esc(s.offReason)}` : ''}`}${s.running ? ', running' : ''}</span>
              <button class="hs-glassbtn hs-inktext" data-act="run" data-id="${esc(s.id)}">Run now</button>
              <button class="hs-glassbtn hs-inktext" data-act="toggle" data-id="${esc(s.id)}">${s.enabled ? 'Switch off' : 'Switch on'}</button>
              <button class="hs-glassbtn hs-inkbad" data-act="remove" data-id="${esc(s.id)}">Remove</button>
            </div>
            <div style="color:var(--mut);font-size:var(--fs-sm)">${esc(s.prompt)}</div>
            <div style="color:var(--dim);font-size:var(--fs-sm)">${s.nextRunAt && s.enabled && !s.spent ? `next ${esc(when(s.nextRunAt))}` : s.spent ? 'ran once' : 'not scheduled'}${s.lastRunAt ? `, last ${esc(when(s.lastRunAt))}` : ''}</div>
          </div>`,
        )
        .join('');
      const suggestionRows = listing.suggestions
        .map(
          (g) => `
          <div class="hs-setrow" style="display:flex;flex-direction:column;gap:4px;padding:10px 14px">
            <div style="display:flex;align-items:center;gap:10px">
              <strong style="flex:1">${esc(g.title)}</strong>
              <span style="color:var(--mut);font-size:var(--fs-sm)">${esc(g.words)}, in ${esc(g.appName)}</span>
              <button class="hs-glassbtn hs-inktext" data-act="approve" data-id="${esc(g.id)}">Approve</button>
              <button class="hs-glassbtn hs-inktext" data-act="dismiss" data-id="${esc(g.id)}">Dismiss</button>
            </div>
            <div style="color:var(--mut);font-size:var(--fs-sm)">${esc(g.reason)} — ${esc(g.prompt)}</div>
          </div>`,
        )
        .join('');
      const runRows = listing.runs
        .slice(0, 30)
        .map((r) => {
          const s = listing.schedules.find((x) => x.id === r.schedule);
          return `
          <div class="hs-setrow" style="display:flex;align-items:center;gap:10px;padding:8px 14px;font-size:var(--fs-sm)" data-run="${esc(r.id)}">
            <span style="flex:1">${esc(s?.title ?? r.schedule)}</span>
            <span style="color:var(--mut)">${esc(when(r.startedAt))}, ${esc(r.why)}</span>
            <span style="color:${r.finishedAt ? (r.stopReason === 'end_turn' ? 'var(--ok)' : 'var(--warn)') : 'var(--mut)'}">${esc(r.finishedAt ? r.stopReason + (r.error ? `: ${r.error}` : '') : 'running')}</span>
            ${r.session ? `<button class="hs-glassbtn hs-inktext" data-act="open" data-session="${esc(r.session)}">Open</button>` : ''}
          </div>`;
        })
        .join('');
      const appOptions = apps.map((a) => `<option value="${esc(a.id)}"${a.id === form.app ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
      const automatic = choices.effective
        ? choices.effective.card
          ? `Automatic (${choices.models.find((m) => m.id === choices.effective.card)?.name ?? choices.effective.card})`
          : `No model: ${choices.effective.reason}`
        : 'Automatic';
      const modelOptions = [`<option value="">${esc(automatic)}</option>`, ...choices.models.map((m) => `<option value="${esc(m.id)}"${m.id === form.model ? ' selected' : ''}>${esc(m.name)}</option>`)].join('');
      const notifyOptions = [['all', 'All runs'], ['failures', 'Failures only'], ['none', 'None']].map(([v, label]) => `<option value="${v}"${form.notify === v ? ' selected' : ''}>${label}</option>`).join('');
      const projectOptions = ['<option value="">No project</option>', ...choices.projects.map((p) => `<option value="${esc(p.id)}"${p.id === form.project ? ' selected' : ''}>${esc(p.name)}</option>`)].join('');
      const timeOptions = [];
      for (let h = 0; h < 24; h += 1) for (const m of ['00', '15', '30', '45']) timeOptions.push(`${String(h).padStart(2, '0')}:${m}`);
      element.innerHTML = `
        <div class="hs-scroll" style="position:absolute;inset:0;overflow:auto">
        <div style="max-width:820px;margin:0 auto;padding:24px;display:flex;flex-direction:column;gap:18px;font-family:var(--font-app);color:var(--text)">
          <h2 style="margin:0">Schedules</h2>
          ${notice ? `<div style="color:var(--bad);font-size:var(--fs-sm)">${esc(notice)}</div>` : ''}
          <section class="hs-settings-card" style="display:flex;flex-direction:column">
            <div class="hs-settings-section" style="padding:10px 14px">Scheduled</div>
            ${scheduleRows || '<div class="hs-setrow hs-settings-note" style="padding:10px 14px">Nothing scheduled yet.</div>'}
          </section>
          ${listing.suggestions.length ? `<section class="hs-settings-card" style="display:flex;flex-direction:column"><div class="hs-settings-section" style="padding:10px 14px">Suggested by apps</div>${suggestionRows}</section>` : ''}
          <section class="hs-settings-card" style="display:flex;flex-direction:column">
            <div class="hs-settings-section" style="padding:10px 14px">New schedule</div>
            <div style="display:grid;grid-template-columns:120px 1fr;gap:8px 12px;padding:10px 14px;align-items:center;font-size:var(--fs-body)">
              <label>App</label><select id="f-app" class="hs-in">${appOptions}</select>
              <label>Title</label><input id="f-title" class="hs-in" value="${esc(form.title)}" placeholder="Morning summary" />
              <label>Prompt</label><textarea id="f-prompt" class="hs-in" rows="3" placeholder="What the app is told when it fires">${esc(form.prompt)}</textarea>
              <label>Repeat</label><select id="f-repeat" class="hs-in">${['daily', 'weekdays', 'weekly', 'monthly', 'custom', 'once'].map((r) => `<option value="${r}"${form.repeat === r ? ' selected' : ''}>${r}</option>`).join('')}</select>
              ${form.repeat === 'weekly' ? `<label>On</label><select id="f-on" class="hs-in">${DAYS.map((d) => `<option${form.on === d ? ' selected' : ''}>${d}</option>`).join('')}</select>` : ''}
              ${form.repeat === 'monthly' ? `<label>Day</label><input id="f-on" class="hs-in" value="${esc(form.on === 'Monday' ? '1' : form.on)}" />` : ''}
              ${form.repeat === 'custom' ? `<label>Cron</label><input id="f-custom" class="hs-in" value="${esc(form.custom)}" placeholder="0 9 */2 * *" />` : ''}
              ${form.repeat === 'once' ? `<label>At</label><input id="f-once" class="hs-in" type="datetime-local" value="${esc(form.once)}" />` : `<label>Time</label><select id="f-at" class="hs-in">${timeOptions.map((t) => `<option${form.at === t ? ' selected' : ''}>${t}</option>`).join('')}</select>`}
              <label>Model</label><select id="f-model" class="hs-in">${modelOptions}</select>
              <label>Project</label><select id="f-project" class="hs-in">${projectOptions}</select>
              <label>Notify</label><select id="f-notify" class="hs-in">${notifyOptions}</select>
              <span></span><div><button id="f-create" class="hs-glassbtn hs-inktext">Create</button></div>
            </div>
          </section>
          <section class="hs-settings-card" style="display:flex;flex-direction:column">
            <div class="hs-settings-section" style="padding:10px 14px">Runs</div>
            ${runRows || '<div class="hs-setrow hs-settings-note" style="padding:10px 14px">No runs yet.</div>'}
          </section>
        </div>
        </div>`;
      const read = () => {
        form.app = element.querySelector('#f-app')?.value ?? form.app;
        form.title = element.querySelector('#f-title')?.value ?? form.title;
        form.prompt = element.querySelector('#f-prompt')?.value ?? form.prompt;
        form.repeat = element.querySelector('#f-repeat')?.value ?? form.repeat;
        form.on = element.querySelector('#f-on')?.value ?? form.on;
        form.at = element.querySelector('#f-at')?.value ?? form.at;
        form.custom = element.querySelector('#f-custom')?.value ?? form.custom;
        form.once = element.querySelector('#f-once')?.value ?? form.once;
        form.model = element.querySelector('#f-model')?.value ?? form.model;
        form.project = element.querySelector('#f-project')?.value ?? form.project;
        form.notify = element.querySelector('#f-notify')?.value ?? form.notify;
      };
      element.querySelector('#f-repeat')?.addEventListener('change', () => {
        read();
        draw();
      });
      element.querySelector('#f-app')?.addEventListener('change', async () => {
        read();
        await loadChoices();
        draw();
      });
      element.querySelector('#f-create')?.addEventListener('click', async () => {
        read();
        const draft = {
          app: form.app,
          title: form.title,
          prompt: form.prompt,
          ...(form.repeat === 'once'
            ? { once: form.once }
            : { spec: specOf(form.repeat, form.on, form.at, form.custom) }),
          ...(form.model && { model: form.model }),
          ...(form.project && { project: form.project }),
          notify: form.notify,
        };
        await act(() => client.invoke('create', { draft }));
        form.title = '';
        form.prompt = '';
      });
      for (const button of element.querySelectorAll('button[data-act]')) {
        button.addEventListener('click', () => {
          const { act: kind, id, session } = button.dataset;
          if (kind === 'open') void client.open({ session });
          else if (kind === 'run') void act(() => client.invoke('runNow', { id }));
          else if (kind === 'remove') void act(() => client.invoke('remove', { id }));
          else if (kind === 'approve') void act(() => client.invoke('approve', { id }));
          else if (kind === 'dismiss') void act(() => client.invoke('dismiss', { id }));
          else if (kind === 'toggle') {
            const s = listing.schedules.find((x) => x.id === id);
            void act(() => client.invoke('set', { id, patch: { enabled: !s.enabled } }));
          }
        });
      }
    };

    const act = async (run) => {
      notice = '';
      try {
        await run();
      } catch (e) {
        notice = e.message;
      }
      await load();
    };
    const loadChoices = async () => {
      choices = form.app ? await client.invoke('choices', { app: form.app }) : { models: [], projects: [], effective: null };
    };
    const load = async () => {
      listing = await client.invoke('list');
      apps = await client.invoke('apps');
      if (!form.app && apps[0]) form.app = apps[0].id;
      await loadChoices();
      draw();
    };
    const stop = client.events('changed', () => void load());
    void load();
    return () => {
      stop();
      element.innerHTML = '';
    };
  });
}
