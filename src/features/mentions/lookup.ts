import { LOOKUP_CHUNK, type MentionsTransport } from "./transport";

/** How long an answer about a name is trusted (a new account may take the
 * name meanwhile; nothing breaks if a link appears a little late). */
const TTL_MS = 10 * 60 * 1000;
/** Names asked for within this window go out in one call. */
const WINDOW_MS = 20;

interface Waiter {
  names: string[];
  resolve: (known: Set<string>) => void;
  reject: (error: unknown) => void;
}

/**
 * One network call for many comments: every comment on a screen asks for its
 * @names at about the same time; the asks are gathered for a moment and sent
 * together (50 names a call), and answers are remembered for 10 minutes. This
 * keeps a long Event hub to one small request on a weak network.
 */
export class MentionLookupBatcher {
  private readonly cache = new Map<string, { exists: boolean; at: number }>();
  private queue: Waiter[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly transport: MentionsTransport,
    private readonly now: () => number = Date.now,
  ) {}

  /** The names among `names` (lower case) that exist. */
  resolve(names: readonly string[]): Promise<Set<string>> {
    const fresh = this.fromCache(names);
    if (fresh) {
      return Promise.resolve(fresh);
    }
    return new Promise((resolve, reject) => {
      this.queue.push({ names: [...names], resolve, reject });
      this.timer ??= setTimeout(() => void this.flush(), WINDOW_MS);
    });
  }

  private fromCache(names: readonly string[]): Set<string> | null {
    const known = new Set<string>();
    for (const name of names) {
      const hit = this.cache.get(name);
      if (!hit || this.now() - hit.at > TTL_MS) {
        return null;
      }
      if (hit.exists) {
        known.add(name);
      }
    }
    return known;
  }

  private async flush(): Promise<void> {
    const waiters = this.queue;
    this.queue = [];
    this.timer = null;
    const wanted = [
      ...new Set(
        waiters
          .flatMap((waiter) => waiter.names)
          .filter((name) => {
            const hit = this.cache.get(name);
            return !hit || this.now() - hit.at > TTL_MS;
          }),
      ),
    ];
    try {
      for (let i = 0; i < wanted.length; i += LOOKUP_CHUNK) {
        const chunk = wanted.slice(i, i + LOOKUP_CHUNK);
        const found = new Set(await this.transport.lookup(chunk));
        const at = this.now();
        for (const name of chunk) {
          this.cache.set(name, { exists: found.has(name), at });
        }
      }
      for (const waiter of waiters) {
        waiter.resolve(
          new Set(waiter.names.filter((name) => this.cache.get(name)?.exists === true)),
        );
      }
    } catch (error) {
      for (const waiter of waiters) {
        waiter.reject(error);
      }
    }
  }
}

const batchers = new WeakMap<MentionsTransport, MentionLookupBatcher>();

/** The one batcher per transport (so the cache is shared by every screen). */
export function batcherFor(transport: MentionsTransport): MentionLookupBatcher {
  let batcher = batchers.get(transport);
  if (!batcher) {
    batcher = new MentionLookupBatcher(transport);
    batchers.set(transport, batcher);
  }
  return batcher;
}
