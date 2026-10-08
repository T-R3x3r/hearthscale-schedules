/**
 * The words the page shows for a time, a run and a schedule's state, and
 * the tone of the dot beside them.
 */
import { useEffect, useState } from 'react';
import type { Run, Schedule } from './client.ts';

export type Tone = 'ok' | 'bad' | 'info' | 'dim';

/** How often words such as "in 5 min" are written again. */
const TICK_MS = 30_000;

/** Draws the calling component again every half minute, so the words of
 *  a time stay true while the page is on screen. */
export function useTick(): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), TICK_MS);
    return () => clearInterval(timer);
  }, []);
}

const days = (n: number) => (n === 1 ? '1 day' : `${n} days`);

/** How far off an instant is, in the coarsest unit that still says
 *  something. */
export function relative(iso: string): string {
  const ms = Date.parse(iso) - Date.now();
  const abs = Math.abs(ms);
  const unit =
    abs < 60_000
      ? 'under a minute'
      : abs < 3_600_000
        ? `${Math.round(abs / 60_000)} min`
        : abs < 86_400_000
          ? `${Math.round(abs / 3_600_000)} h`
          : days(Math.round(abs / 86_400_000));
  return ms < 0 ? `${unit} ago` : `in ${unit}`;
}

/** How a run went, in a word or two before the time it started, and the
 *  dot's tone. */
export function outcome(run: Run): { word: string; tone: Tone } {
  if (!run.finishedAt) return { word: 'Started', tone: 'info' };
  switch (run.stopReason) {
    case 'end_turn':
      return { word: 'Ran', tone: 'ok' };
    case 'cancelled':
      return { word: 'Stopped', tone: 'dim' };
    case 'interrupted':
      return { word: 'Interrupted', tone: 'dim' };
    case 'refused':
      return { word: 'Could not start', tone: 'bad' };
    case 'gone':
      return { word: 'Ended unseen', tone: 'dim' };
    default:
      return { word: 'Failed', tone: 'bad' };
  }
}

/** Where a schedule stands, for the second half of its row's sub-line,
 *  and the dot's tone. */
export function standing(s: Schedule): { words: string; tone: Tone } {
  if (s.running) return { words: 'Running now', tone: 'info' };
  if (s.spent) return { words: s.lastRunAt ? `Ran ${relative(s.lastRunAt)}` : 'Ran', tone: 'dim' };
  if (!s.enabled) {
    return s.offReason
      ? { words: `Paused: ${s.offReason}`, tone: 'bad' }
      : { words: 'Paused', tone: 'dim' };
  }
  if (s.nextRunAt) return { words: `Next run ${relative(s.nextRunAt)}`, tone: 'ok' };
  return { words: 'No run within a year', tone: 'dim' };
}
