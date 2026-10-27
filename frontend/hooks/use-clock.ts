"use client";

import { useEffect, useState } from "react";

/**
 * 1 s ticker for the command-bar clock (Doc 06 §5.2).
 *
 * Hydration-safe: the server has no wall clock that matches the client, so the
 * first render returns `null` and the value only appears after mount. Callers
 * render a stable placeholder for that frame instead of a mismatched time.
 */
export function useClock(intervalMs = 1000): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}

/** Lease countdown: value updates once per second; the only motion is a colour change. */
export function useCountdown(seconds: number | null): number | null {
  const [value, setValue] = useState(seconds);

  useEffect(() => {
    setValue(seconds);
  }, [seconds]);

  useEffect(() => {
    if (value === null || value <= 0) return;
    const timer = window.setInterval(
      () => setValue((current) => (current === null ? null : Math.max(0, current - 1))),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [value]);

  return value;
}
