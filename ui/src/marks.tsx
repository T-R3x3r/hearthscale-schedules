/**
 * The marks at the head of a row: the app a schedule runs in, and the
 * dot of its state.
 */
import { useSyncExternalStore } from 'react';
import type { AppFacts } from './client.ts';
import { AppIcon } from './kit.tsx';
import type { Tone } from './words.ts';

/** The scheme the view wears: the document's `data-theme`, which the host
 *  sets with each appearance; null before the first. */
function wornScheme(): 'light' | 'dark' | null {
  const scheme = document.documentElement.dataset.theme;
  return scheme === 'light' || scheme === 'dark' ? scheme : null;
}

function watchScheme(changed: () => void): () => void {
  const observer = new MutationObserver(changed);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/** The platform the view is served from: the origin of the kit's style
 *  sheet, which also serves the pictures of every app's package. */
const platform = new URL(
  document.querySelector<HTMLLinkElement>('link[rel="stylesheet"][href$="/ui/ui.css"]')!.href,
).origin;

/** The app's own icon for the scheme on screen, served from its package,
 *  on a plate; the app mark where the app has none or the scheme is not
 *  known yet. */
export function AppMark({ app }: { app: AppFacts | undefined }) {
  const scheme = useSyncExternalStore(watchScheme, wornScheme);
  const src = app?.icon && scheme ? `${platform}/apps/${app.id}/ui/${app.icon[scheme]}` : null;
  return (
    <span className="schedules-plate">
      <AppIcon src={src} size={22} />
    </span>
  );
}

/** A small round mark in a state's colour. */
export function StateDot({ tone }: { tone: Tone }) {
  return <span className="schedules-dot" data-tone={tone} />;
}
