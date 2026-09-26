/**
 * The Schedules app's page: the main view lists every schedule, and the
 * `schedule` panel reads, changes or makes one, a tab per schedule. Both
 * are React on the design system, mounted into the element the realm
 * hands over and unmounted when it takes it back.
 */
import { createRoot } from 'react-dom/client';
import type { RealmClient } from '@hearthscale/app';
import { Backend } from './client.ts';
import { Detail } from './Detail.tsx';
import { List } from './List.tsx';
import './ui.css';

export default function activate(client: RealmClient) {
  const backend = new Backend(client);
  client.view((element) => {
    const root = createRoot(element);
    root.render(<List backend={backend} client={client} />);
    return () => root.unmount();
  });
  client.panel('schedule', (element, slot) => {
    const root = createRoot(element);
    root.render(<Detail backend={backend} client={client} tabKey={slot.key} />);
    return () => root.unmount();
  });
}
