/**
 * The Schedules view, which fills the app's tab: the list of every
 * schedule, and in its place one schedule to read and change or a new
 * one to make. The list stays mounted under a schedule, so its filter,
 * its search and its scroll are where the person left them.
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import { Backend } from './client.ts';
import { Detail } from './Detail.tsx';
import { List } from './List.tsx';
import sheet from './ui.css?inline';

/** What shows over the list: nothing, one schedule, or the form of a new
 *  one, which `key` keeps apart from the last new one. */
type Shown = { kind: 'list' } | { kind: 'schedule'; id: string } | { kind: 'new'; key: number };

function Schedules({ backend }: { backend: Backend }) {
  const [shown, setShown] = useState<Shown>({ kind: 'list' });
  const back = () => setShown({ kind: 'list' });
  return (
    <>
      <div className="schedules-screen" data-shown={shown.kind === 'list' ? 'true' : 'false'}>
        <List
          backend={backend}
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

const app = new App({ name: 'Schedules', version: '2.0.0' }, {}, { autoResize: false });
const backend = new Backend(app);
await app.connect(new PostMessageTransport(window.parent, window.parent));

const root = document.createElement('div');
root.className = 'schedules-root';
document.body.append(root);
createRoot(root).render(<Schedules backend={backend} />);
