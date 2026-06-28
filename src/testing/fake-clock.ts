export type ScheduledCallback = () => void;

interface ScheduledTimer {
  readonly callback: ScheduledCallback;
  readonly id: number;
  readonly runAtMs: number;
}

export class FakeClock {
  #nowMs: number;
  #nextTimerId = 1;
  readonly #timers = new Map<number, ScheduledTimer>();

  constructor(startTime: Date | number = 0) {
    this.#nowMs = toEpochMs(startTime);
  }

  now(): number {
    return this.#nowMs;
  }

  date(): Date {
    return new Date(this.#nowMs);
  }

  setTime(time: Date | number): void {
    this.#nowMs = toEpochMs(time);
    this.#runDueTimersUntil(this.#nowMs);
  }

  advanceBy(durationMs: number): void {
    assertNonNegativeFinite(durationMs, "durationMs");
    this.advanceTo(this.#nowMs + durationMs);
  }

  advanceTo(time: Date | number): void {
    const targetMs = toEpochMs(time);

    if (targetMs < this.#nowMs) {
      throw new RangeError("FakeClock cannot advance backward.");
    }

    this.#runDueTimersUntil(targetMs);
    this.#nowMs = targetMs;
  }

  setTimeout(callback: ScheduledCallback, delayMs: number): number {
    assertNonNegativeFinite(delayMs, "delayMs");

    const id = this.#nextTimerId;
    this.#nextTimerId += 1;
    this.#timers.set(id, {
      callback,
      id,
      runAtMs: this.#nowMs + delayMs,
    });

    return id;
  }

  clearTimeout(timerId: number): boolean {
    return this.#timers.delete(timerId);
  }

  pendingTimerCount(): number {
    return this.#timers.size;
  }

  #runDueTimersUntil(targetMs: number): void {
    let nextTimer = this.#nextDueTimer(targetMs);

    while (nextTimer !== undefined) {
      this.#timers.delete(nextTimer.id);
      this.#nowMs = nextTimer.runAtMs;
      nextTimer.callback();
      nextTimer = this.#nextDueTimer(targetMs);
    }
  }

  #nextDueTimer(targetMs: number): ScheduledTimer | undefined {
    let nextTimer: ScheduledTimer | undefined;

    for (const timer of this.#timers.values()) {
      if (timer.runAtMs > targetMs) {
        continue;
      }

      if (
        nextTimer === undefined ||
        timer.runAtMs < nextTimer.runAtMs ||
        (timer.runAtMs === nextTimer.runAtMs && timer.id < nextTimer.id)
      ) {
        nextTimer = timer;
      }
    }

    return nextTimer;
  }
}

function toEpochMs(time: Date | number): number {
  const value = time instanceof Date ? time.getTime() : time;

  assertNonNegativeFinite(value, "time");

  return value;
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number.`);
  }
}
