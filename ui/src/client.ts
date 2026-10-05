/**
 * What the page asks of its app and of the platform, typed: each call of
 * the backend is one of the tools `app.json` declares for the app's own
 * view alone, and the records are the ones the backend keeps. The view
 * hears the backend's `changed` event and opens a run's conversation
 * through the platform's extensions, which `uses` names.
 */
import { App, McpUiMessageResultSchema } from '@modelcontextprotocol/ext-apps';

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
  private readonly changes = new Set<() => void>();

  constructor(private readonly app: App) {
    app.fallbackNotificationHandler = async (note) => {
      const params = note.params as { name?: unknown } | undefined;
      if (note.method === 'hearthscale/events/event' && params?.name === 'changed') {
        for (const fn of this.changes) fn();
      }
    };
  }

  /** Calls `fn` each time the backend says its record changed; answers
   *  the function that stops it. */
  onChanged(fn: () => void): () => void {
    this.changes.add(fn);
    return () => this.changes.delete(fn);
  }

  /** One tool of the backend: its structured answer, else its words. A
   *  call that changes something runs on the person's click, and `label`
   *  is the control it pressed. A refusal rejects with the backend's
   *  words. */
  private async call<T>(name: string, args: object = {}, label?: string): Promise<T> {
    const result = await this.app.callServerTool({
      name,
      arguments: args as Record<string, unknown>,
      ...(label !== undefined && { _meta: { 'hearthscale/label': label } }),
    });
    const words = result.content
      .flatMap((block) => (block.type === 'text' ? [block.text] : []))
      .join('\n');
    if (result.isError) throw new Error(words || `${name} failed`);
    return (result.structuredContent ?? words) as T;
  }

  list(): Promise<Listing> {
    return this.call('listing');
  }

  async apps(): Promise<AppFacts[]> {
    return (await this.call<{ apps: AppFacts[] }>('apps')).apps;
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
    return this.call('add', { draft }, 'Create');
  }

  set(id: string, patch: Partial<Fields> & { enabled?: boolean }, label: string): Promise<void> {
    return this.call('set', { id, patch }, label);
  }

  remove(id: string): Promise<void> {
    return this.call('delete', { id }, 'Delete');
  }

  runNow(id: string): Promise<void> {
    return this.call('runNow', { id }, 'Run now');
  }

  approve(id: string): Promise<void> {
    return this.call('approve', { id }, 'Add');
  }

  dismiss(id: string): Promise<void> {
    return this.call('dismiss', { id }, 'Dismiss');
  }

  /** Keeps what the view shows for its next load. */
  async keep(state: unknown): Promise<void> {
    await this.extension('hearthscale/ui/set-widget-state', { state });
  }

  /** Opens a run's conversation in its own app, on the person's click. */
  async open(session: string): Promise<void> {
    await this.extension('hearthscale/surfaces/open', { session });
  }

  /** One of the host's `hearthscale/*` extensions, a request the SDK's
   *  types do not name; its result arrives whole. */
  private extension(method: string, params: Record<string, unknown>): Promise<unknown> {
    const request = this.app.request.bind(this.app) as (
      message: { method: string; params: Record<string, unknown> },
      schema: typeof McpUiMessageResultSchema,
    ) => Promise<unknown>;
    return request({ method, params }, McpUiMessageResultSchema);
  }
}

/** A refusal's message, as the page shows it. */
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
