/**
 * What the page asks the app's backend, typed: each call is one `invoke`
 * handler in `backend.js`, and the records are the ones it keeps. The
 * `schedule` panel opens a tab per schedule, keyed by its id; a tab for
 * a schedule not made yet has a key of its own shape.
 */
import type { RealmClient } from '@hearthscale/app';

export type Notify = 'all' | 'failures' | 'none';

/** A schedule as the backend shows it: the record, its rhythm in words
 *  and the display name of its app. */
export interface Schedule {
  id: string;
  app: string;
  appName: string;
  title: string;
  prompt: string;
  enabled: boolean;
  notify: Notify;
  spec?: string;
  once?: string;
  spent: boolean;
  running?: boolean;
  project?: string;
  model?: string;
  nextRunAt: string | null;
  lastRunAt?: string;
  /** Why the backend switched the schedule off. */
  offReason?: string;
  words: string;
}

/** One run of a schedule; one with no `finishedAt` is still going. */
export interface Run {
  id: string;
  schedule: string;
  startedAt: string;
  session?: string;
  finishedAt?: string;
  stopReason?: string;
  error?: string;
}

/** A schedule an agent or the backend proposes, waiting for Add or
 *  Dismiss. */
export interface Suggestion {
  id: string;
  app: string;
  appName: string;
  title: string;
  prompt: string;
  reason: string;
  words: string;
}

export interface Listing {
  schedules: Schedule[];
  /** Newest first. */
  runs: Run[];
  suggestions: Suggestion[];
}

/** An app a schedule may run in: enabled, with an agent. */
export interface AppFacts {
  id: string;
  name: string;
  /** The icon's file in the app's package per colour scheme. */
  icon: { light: string; dark: string } | null;
}

/** What a schedule of one app may run on and in. */
export interface Choices {
  models: { id: string; name: string }[];
  projects: { id: string; name: string }[];
  /** The model the app runs on while the schedule names none, or why
   *  none can. */
  effective: { card: string } | { card: null; reason: string };
}

/** The fields the form writes; an empty `model` or `project` is the
 *  app's own choice. */
export interface Fields {
  app: string;
  title: string;
  prompt: string;
  notify: Notify;
  model: string;
  project: string;
  spec?: string;
  once?: string;
}

export class Backend {
  constructor(private readonly client: RealmClient) {}

  private call<T>(method: string, params?: object): Promise<T> {
    return this.client.invoke(method, params) as Promise<T>;
  }

  list(): Promise<Listing> {
    return this.call('list');
  }

  apps(): Promise<AppFacts[]> {
    return this.call('apps');
  }

  choices(app: string): Promise<Choices> {
    return this.call('choices', { app });
  }

  /** A cron expression's rhythm in words; rejects one that does not parse. */
  words(spec: string): Promise<string> {
    return this.call('words', { spec });
  }

  /** Makes a schedule whose expression is read in `timezone`. */
  create(draft: Fields & { timezone: string }): Promise<Schedule> {
    return this.call('create', { draft });
  }

  set(id: string, patch: Partial<Fields> & { enabled?: boolean }): Promise<void> {
    return this.call('set', { id, patch });
  }

  remove(id: string): Promise<void> {
    return this.call('remove', { id });
  }

  runNow(id: string): Promise<void> {
    return this.call('runNow', { id });
  }

  approve(id: string): Promise<void> {
    return this.call('approve', { id });
  }

  dismiss(id: string): Promise<void> {
    return this.call('dismiss', { id });
  }
}

const NEW_KEY = 'new:';

/** The key of a tab for a schedule not made yet. */
export const newScheduleKey = (): string => `${NEW_KEY}${Date.now().toString(36)}`;

/** Whether a tab's key names a schedule not made yet; a tab opened with
 *  no key is one too. */
export const isNewKey = (key: string | undefined): boolean =>
  key === undefined || key.startsWith(NEW_KEY);

/** A refusal's message, as the page shows it. */
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
