import { describe, expect, it } from "vitest";

import { FakeClock } from "./fake-clock.js";

describe("FakeClock", () => {
  it("advances time and runs due scheduled callbacks deterministically", () => {
    const clock = new FakeClock(Date.UTC(2026, 0, 1));
    const events: string[] = [];

    clock.setTimeout(() => events.push(`late:${clock.now()}`), 20);
    clock.setTimeout(() => events.push(`early:${clock.now()}`), 10);

    clock.advanceBy(9);

    expect(events).toEqual([]);
    expect(clock.now()).toBe(Date.UTC(2026, 0, 1) + 9);

    clock.advanceBy(1);

    expect(events).toEqual([`early:${Date.UTC(2026, 0, 1) + 10}`]);

    clock.advanceBy(10);

    expect(events).toEqual([
      `early:${Date.UTC(2026, 0, 1) + 10}`,
      `late:${Date.UTC(2026, 0, 1) + 20}`,
    ]);
  });

  it("can clear scheduled callbacks before fake time reaches them", () => {
    const clock = new FakeClock(0);
    const events: string[] = [];

    const timerId = clock.setTimeout(() => events.push("should-not-run"), 5);

    clock.clearTimeout(timerId);
    clock.advanceBy(5);

    expect(events).toEqual([]);
  });
});
