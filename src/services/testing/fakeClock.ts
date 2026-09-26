/**
 * Deterministic time for the sync engine: `now`, an auto-advancing `sleep` (it moves the clock forward and
 * resolves at once, recording the wait), and `schedule` timers that fire only when a test calls `advance`.
 */
export class FakeClock {
  private t: number;
  private timers: { at: number; seq: number; fn: () => void }[] = [];
  private seq = 0;
  /** Every `sleep` duration, in call order. */
  readonly sleeps: number[] = [];

  constructor(start = 1_760_000_000_000) {
    this.t = start;
  }

  readonly now = (): number => this.t;

  readonly sleep = async (ms: number): Promise<void> => {
    this.sleeps.push(ms);
    this.t += Math.max(0, ms);
  };

  readonly schedule = (fn: () => void, ms: number): (() => void) => {
    const timer = { at: this.t + Math.max(0, ms), seq: this.seq++, fn };
    this.timers.push(timer);
    return () => {
      this.timers = this.timers.filter((x) => x !== timer);
    };
  };

  /** Pending timers' due times, soonest first. */
  pending(): number[] {
    return this.timers.map((x) => x.at).sort((a, b) => a - b);
  }

  /** Moves time forward by `ms`, firing due timers in order and letting their async work settle. */
  async advance(ms: number): Promise<void> {
    const end = this.t + ms;
    for (;;) {
      const due = this.timers
        .filter((x) => x.at <= end)
        .sort((a, b) => a.at - b.at || a.seq - b.seq)[0];
      if (due === undefined) break;
      this.timers = this.timers.filter((x) => x !== due);
      this.t = Math.max(this.t, due.at);
      due.fn();
      await settle();
    }
    this.t = Math.max(this.t, end);
    await settle();
  }
}

/** Lets pending promise chains run to completion (enough turns for a whole fake sync cycle). */
export async function settle(turns = 50): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise<void>((resolve) => setImmediate(resolve));
}
