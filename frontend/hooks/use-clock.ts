"use client";

import { useEffect, useState } from "react";

/** 1 s ticker for the command-bar clock (Doc 06 §5.2). Local time, UTC in `title`. */

export function useClock(intervalMs = 1000): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
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
    const timer = window.setInterval(() => setValue((current) => (current === null ? null : Math.max(0, current - 1))), 1000);
    return () => window.clearInterval(timer);
  }, [value]);

  return value;
}
