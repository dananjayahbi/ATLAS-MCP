import { describe, expect, it } from "vitest";
import { createRingBuffer, TASK_LOG_MAX_LINES } from "@/lib/sse/ring-buffer";
import { sanitiseMessage, sanitiseText, clampMessage, MAX_MESSAGE } from "@/lib/sse/sanitise";
import { formatDuration, formatCountdown, formatAgeHours, formatOverdue } from "@/lib/format/duration";
import { basename, shortenPath, shortTaskId } from "@/lib/format/path";
import { priorityBand, clampPriority } from "@/lib/format/priority";
import { progressTone, clampPercent } from "@/lib/format/percent";
import { STATUS_META } from "@/lib/format/tone";

describe("ring buffer", () => {
  it("keeps insertion order", () => {
    const ring = createRingBuffer<number>({ maxLines: 3 });
    [1, 2, 3].forEach((n) => ring.append(n));
    expect(ring.getSnapshot().items).toEqual([1, 2, 3]);
  });

  it("evicts the oldest past maxLines", () => {
    const ring = createRingBuffer<number>({ maxLines: 3 });
    [1, 2, 3, 4, 5].forEach((n) => ring.append(n));
    const snap = ring.getSnapshot();
    expect(snap.items).toEqual([3, 4, 5]);
    expect(snap.dropped).toBe(2);
  });

  it("survives more lines than the production ceiling without unbounded growth", () => {
    const ring = createRingBuffer<number>({ maxLines: TASK_LOG_MAX_LINES });
    for (let i = 0; i < TASK_LOG_MAX_LINES + 250; i += 1) ring.append(i);
    expect(ring.getSnapshot().items.length).toBe(TASK_LOG_MAX_LINES);
  });

  it("returns a stable snapshot until the next mutation", () => {
    const ring = createRingBuffer<number>({ maxLines: 5 });
    ring.append(1);
    const a = ring.getSnapshot();
    const b = ring.getSnapshot();
    expect(a).toBe(b);
    ring.append(2);
    expect(ring.getSnapshot()).not.toBe(a);
  });

  it("clear empties the buffer", () => {
    const ring = createRingBuffer<number>({ maxLines: 5 });
    ring.append(1);
    ring.clear();
    expect(ring.getSnapshot().items).toEqual([]);
  });
});

describe("log sanitisation", () => {
  it("strips ANSI CSI sequences", () => {
    expect(sanitiseText("\u001b[31mred\u001b[0m")).toBe("red");
  });

  it("strips OSC sequences", () => {
    expect(sanitiseText("a\u001b]0;title\u0007b")).toBe("ab");
  });

  it("drops C0 control characters but keeps tabs as spaces", () => {
    expect(sanitiseText("a\u0000b\u0007c")).toBe("abc");
    expect(sanitiseText("a\tb")).toContain("b");
  });

  it("clamps to the 4000-char ceiling with a visible marker", () => {
    const out = sanitiseMessage("x".repeat(10_000));
    expect(out.length).toBeLessThanOrEqual(MAX_MESSAGE);
    expect(out).toContain("truncated");
  });

  it("leaves short messages untouched", () => {
    expect(clampMessage("hello")).toBe("hello");
  });
});

describe("formatters", () => {
  it("formats durations in human units", () => {
    expect(formatDuration(0)).toBeTruthy();
    expect(formatDuration(59)).toMatch(/59/);
    expect(formatDuration(3661)).toMatch(/1h/);
  });

  it("renders a countdown from lease seconds", () => {
    expect(formatCountdown(null)).toBeTruthy();
    expect(formatCountdown(0)).toBeTruthy();
    expect(formatCountdown(612)).toMatch(/10/);
  });

  it("formats overdue seconds against the agent estimate", () => {
    expect(formatOverdue(3900)).toBe("1h 05m over");
    expect(formatOverdue(750)).toBe("12m 30s over");
    expect(formatOverdue(0)).toBe("—");
    expect(formatOverdue(Number.NaN)).toBe("—");
    expect(formatOverdue(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("formats age in hours", () => {
    expect(formatAgeHours(0.5)).toBeTruthy();
    expect(formatAgeHours(51.2)).toContain("2");
  });

  it("extracts Windows and POSIX basenames", () => {
    expect(basename("E:\\dev\\alpha\\auth.py")).toBe("auth.py");
    expect(basename("/home/u/alpha/auth.py")).toBe("auth.py");
  });

  it("shortens long paths but keeps the basename", () => {
    const out = shortenPath("E:\\very\\deep\\nested\\folder\\structure\\file.png", 20);
    expect(out).toContain("file.png");
    expect(out.length).toBeLessThanOrEqual(24);
  });

  it("shortens a task UUID to a stable prefix", () => {
    expect(shortTaskId("5f2d6c1e-1f0b-4c5b-9a2e-77d0d2f3c901")).toBe("TASK-5F2D6C1E");
  });
});

describe("priority + percent", () => {
  it("bands priorities on the documented boundaries", () => {
    expect(priorityBand(0)).toBe("low");
    expect(priorityBand(39)).toBe("low");
    expect(priorityBand(40)).toBe("medium");
    expect(priorityBand(69)).toBe("medium");
    expect(priorityBand(70)).toBe("high");
    expect(priorityBand(89)).toBe("high");
    expect(priorityBand(90)).toBe("critical");
    expect(priorityBand(100)).toBe("critical");
  });

  it("clamps out-of-range priorities", () => {
    expect(clampPriority(-5)).toBe(0);
    expect(clampPriority(900)).toBe(100);
  });

  it("classifies progress tone", () => {
    expect(progressTone(0)).toBe("empty");
    expect(progressTone(50)).toBe("partial");
    expect(progressTone(100)).toBe("complete");
  });

  it("clamps percentages", () => {
    expect(clampPercent(-1)).toBe(0);
    expect(clampPercent(101)).toBe(100);
  });
});

describe("status tone map", () => {
  it("covers all six frozen statuses", () => {
    expect(Object.keys(STATUS_META).sort()).toEqual(
      ["COMPLETED", "IN_PROGRESS", "IN_REVIEW", "PENDING", "PENDING_APPROVAL", "REJECTED"],
    );
  });

  it("uses token classes only, never raw hex", () => {
    for (const meta of Object.values(STATUS_META)) {
      expect(JSON.stringify(meta)).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    }
  });
});
