/**
 * A schedule's timing as the form picks it: a repeat, a day and a time,
 * or one instant. The record holds a cron expression or an instant; these
 * convert both ways for the shapes the form offers, and any other
 * expression reads as custom, kept as written. The words a rhythm reads
 * as come from the backend.
 */

export type Repeat = 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'once' | 'custom';

export const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export interface Rhythm {
  repeat: Repeat;
  /** A weekday name for `weekly`, a day of the month for `monthly`. */
  on: string;
  /** `HH:MM` for a repeat. */
  at: string;
  /** A local `YYYY-MM-DDTHH:MM` for `once`. */
  once: string;
  /** The expression as written, for `custom`. */
  cron: string;
}

export const BLANK_RHYTHM: Rhythm = {
  repeat: 'daily',
  on: 'monday',
  at: '09:00',
  once: '',
  cron: '',
};

const pad = (n: number) => String(n).padStart(2, '0');

/** The time as a clock reads it, from a `HH:MM`. */
function clock(at: string): string {
  const [h, m] = at.split(':');
  return `${Number(h)}:${m}`;
}

/** The quarter hours of a day, as a picker lists them; a time off that
 *  grid is listed in its place so a record keeps what it has. */
export function timeOptions(current: string): { value: string; label: string }[] {
  const times: string[] = [];
  for (let h = 0; h < 24; h++) for (const m of [0, 15, 30, 45]) times.push(`${pad(h)}:${pad(m)}`);
  if (/^\d\d:\d\d$/.test(current) && !times.includes(current)) times.push(current);
  times.sort();
  return times.map((value) => ({ value, label: clock(value) }));
}

/** The next ninety days, as a picker lists them, plus the date a record
 *  already holds where it lies outside them. */
export function dateOptions(current: string): { value: string; label: string }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days: { value: string; label: string }[] = [];
  for (let i = 0; i < 90; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const label =
      i === 0
        ? 'Today'
        : i === 1
          ? 'Tomorrow'
          : d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
    days.push({ value, label });
  }
  if (current && !days.some((d) => d.value === current)) {
    days.push({
      value: current,
      label: new Date(`${current}T00:00`).toLocaleDateString([], {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      }),
    });
  }
  return days;
}

/** The date and the time halves of a `once` value. */
export function onceParts(once: string): { date: string; time: string } {
  const [date = '', time = ''] = once.split('T');
  return { date, time };
}

/** Tomorrow at nine, where a one-time schedule starts from. */
export function defaultOnce(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
}

/** A local date-time value for an instant. */
function localInput(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The rhythm a record reads as. */
export function fromSchedule(s: { spec?: string; once?: string }): Rhythm {
  if (s.once !== undefined) return { ...BLANK_RHYTHM, repeat: 'once', once: localInput(s.once) };
  const spec = s.spec ?? '';
  const parts = spec.trim().split(/\s+/);
  const [minute = '', hour = '', dom = '', month = '', dow = ''] = parts;
  if (parts.length === 5 && /^\d+$/.test(minute) && /^\d+$/.test(hour)) {
    const at = `${pad(Number(hour))}:${pad(Number(minute))}`;
    if (dom === '*' && month === '*') {
      if (dow === '*') return { ...BLANK_RHYTHM, repeat: 'daily', at };
      if (dow === '1-5') return { ...BLANK_RHYTHM, repeat: 'weekdays', at };
      if (/^[0-6]$/.test(dow))
        return { ...BLANK_RHYTHM, repeat: 'weekly', on: DAYS[Number(dow)], at };
    }
    if (/^\d+$/.test(dom) && Number(dom) <= 28 && month === '*' && dow === '*') {
      return { ...BLANK_RHYTHM, repeat: 'monthly', on: String(Number(dom)), at };
    }
  }
  return { ...BLANK_RHYTHM, repeat: 'custom', cron: spec };
}

/** The record's timing for a rhythm. Throws in words where the form is
 *  not complete. */
export function toTiming(r: Rhythm): { spec: string } | { once: string } {
  if (r.repeat === 'once') {
    if (!r.once) throw new Error('Pick the date and time it runs at.');
    const at = new Date(r.once);
    if (Number.isNaN(at.getTime())) throw new Error('That is not a date and time.');
    return { once: at.toISOString() };
  }
  if (r.repeat === 'custom') {
    if (!r.cron.trim()) throw new Error('Write the schedule under Advanced.');
    return { spec: r.cron.trim() };
  }
  const [hour, minute] = r.at.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) throw new Error('Pick a time.');
  if (r.repeat === 'daily') return { spec: `${minute} ${hour} * * *` };
  if (r.repeat === 'weekdays') return { spec: `${minute} ${hour} * * 1-5` };
  if (r.repeat === 'weekly') {
    const dow = DAYS.indexOf(r.on);
    if (dow < 0) throw new Error('Pick a weekday.');
    return { spec: `${minute} ${hour} * * ${dow}` };
  }
  const dom = Number(r.on);
  if (!Number.isInteger(dom) || dom < 1 || dom > 28) throw new Error('Pick a day of the month.');
  return { spec: `${minute} ${hour} ${dom} * *` };
}

/** The ordinal a day of the month reads as. */
export function ordinal(n: number): string {
  const rest = n % 100;
  const suffix =
    rest >= 11 && rest <= 13
      ? 'th'
      : n % 10 === 1
        ? 'st'
        : n % 10 === 2
          ? 'nd'
          : n % 10 === 3
            ? 'rd'
            : 'th';
  return `${n}${suffix}`;
}
