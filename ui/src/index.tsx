/**
 * The Schedules view, which fills the app's tab: the list of every
 * schedule, and in its place one schedule to read and change or a new
 * one to make. The list stays mounted under a schedule, so its filter,
 * its search and its scroll are where the person left them. The open
 * schedule, the filter and the search are kept with the host for the
 * view's next load.
 */
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { Backend } from './client.ts';
import { Detail } from './Detail.tsx';
import { List, type Filter } from './List.tsx';
import sheet from './ui.css?inline';

/** What shows over the list: nothing, one schedule, or the form of a new
 *  one, which `key` keeps apart from the last new one. */
type Shown = { kind: 'list' } | { kind: 'schedule'; id: string } | { kind: 'new'; key: number };

/** What the view keeps for its next load: the schedule open over the
 *  list, and the list's filter and search. */
interface Kept {
  open: string | null;
  filter: Filter;
  query: string;
}

const FILTERS: Filter[] = ['all', 'active', 'paused', 'completed'];

/** The state the host gave back, read field by field. */
function keptOf(state: unknown): Kept {
  const held = (typeof state === 'object' && state !== null ? state : {}) as Partial<
    Record<keyof Kept, unknown>
  >;
  return {
    open: typeof held.open === 'string' ? held.open : null,
    filter: FILTERS.find((f) => f === held.filter) ?? 'all',
    query: typeof held.query === 'string' ? held.query : '',
  };
}

function Schedules({ backend, kept }: { backend: Backend; kept: Kept }) {
  const [shown, setShown] = useState<Shown>(
    kept.open === null ? { kind: 'list' } : { kind: 'schedule', id: kept.open },
  );
  const [filter, setFilter] = useState(kept.filter);
  const [query, setQuery] = useState(kept.query);
  const open = shown.kind === 'schedule' ? shown.id : null;
  useEffect(() => {
    void backend.keep({ open, filter, query } satisfies Kept);
  }, [backend, open, filter, query]);
  const back = () => setShown({ kind: 'list' });
  return (
    <>
      <div className="schedules-screen" data-shown={shown.kind === 'list' ? 'true' : 'false'}>
        <List
          backend={backend}
          filter={filter}
          query={query}
          onFilter={setFilter}
          onQuery={setQuery}
          onOpen={(id) => setShown({ kind: 'schedule', id })}
          onCreate={() => setShown({ kind: 'new', key: Date.now() })}
        />
      </div>
      {shown.kind !== 'list' && (
        <div className="schedules-screen" data-shown="true">
          <Detail
            key={shown.kind === 'new' ? `new:${shown.key}` : shown.id}
            backend={backend}
            id={shown.kind === 'new' ? null : shown.id}
            onBack={back}
            onShow={(id) => setShown({ kind: 'schedule', id })}
          />
        </div>
      )}
    </>
  );
}

const style = document.createElement('style');
style.textContent = sheet;
document.head.append(style);

const app = new App({ name: 'Schedules', version: '2.0.3' }, {}, { autoResize: false });
const backend = new Backend(app);
await app.connect(new PostMessageTransport(window.parent, window.parent));

const root = document.createElement('div');
root.className = 'schedules-root';
document.body.append(root);
const kept = keptOf(
  (app.getHostContext() as Record<string, unknown> | undefined)?.['hearthscale/widgetState'],
);
createRoot(root).render(<Schedules backend={backend} kept={kept} />);
