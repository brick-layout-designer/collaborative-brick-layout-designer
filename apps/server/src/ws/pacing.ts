// How fast one live connection may send, as token buckets (a burst, then a
// steady rate). The numbers are far above what the apps send
// (routes/test/wsPacing.test.ts measures them): an edit is one message per
// action (a drag writes once, on the drop), presence goes out at most 20
// times a second, a reconnect after offline work is one sync step 2, and a
// client asks for the whole layout (sync step 1) once per connection, twice
// when an update it got couldn't be read.

/** Per-connection limits. Mutable only so tests can tighten them. */
export const wsPacing = {
  /** Messages of any kind: a burst of this many... */
  messageBurst: 1000,
  /** ...then this many a second. */
  messagesPerSecond: 250,
  /** Bytes: a burst of this many (three of the largest message taken, 16 MiB)... */
  byteBurst: 48 * 1024 * 1024,
  /** ...then this many a second. */
  bytesPerSecond: 8 * 1024 * 1024,
  /** Requests for the layout (sync step 1): a burst of this many... */
  step1Burst: 5,
  /** ...then one every this many milliseconds. */
  step1EveryMs: 10_000,
};

export class TokenBucket {
  private readonly capacity: number;
  private readonly perMs: number;
  private tokens: number;
  private last: number;

  constructor(capacity: number, perMs: number, now: number = Date.now()) {
    this.capacity = capacity;
    this.perMs = perMs;
    this.tokens = capacity;
    this.last = now;
  }

  /** Take `n` tokens if there are that many; false (and nothing taken) if not. */
  take(n = 1, now: number = Date.now()): boolean {
    this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.perMs);
    this.last = now;
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

/** One connection's buckets. */
export interface Pace {
  messages: TokenBucket;
  bytes: TokenBucket;
  step1: TokenBucket;
}

export function newPace(now: number = Date.now()): Pace {
  return {
    messages: new TokenBucket(wsPacing.messageBurst, wsPacing.messagesPerSecond / 1000, now),
    bytes: new TokenBucket(wsPacing.byteBurst, wsPacing.bytesPerSecond / 1000, now),
    step1: new TokenBucket(wsPacing.step1Burst, 1 / wsPacing.step1EveryMs, now),
  };
}
