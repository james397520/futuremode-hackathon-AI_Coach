'use client';

/**
 * Elapsed / remaining session time (§15 timer, §21 time limit).
 * Freezes while the session is paused and after it completes, so the header
 * never keeps counting on a dead session.
 */
import { useEffect, useState } from 'react';

import { formatTimer } from '../lib/format';
import {
  useCompletedAtMs,
  usePausedAccumulatedMs,
  usePausedAtMs,
  useSessionStatus,
  useStartedAtMs,
} from '../store/session-store';

export interface SessionTimer {
  elapsedMs: number;
  elapsedLabel: string;
  remainingMs: number | null;
  remainingLabel: string | null;
  /** 0–1 progress against the scenario time limit. */
  limitProgress: number | null;
  overtime: boolean;
  running: boolean;
}

export function useSessionTimer(timeLimitSeconds?: number): SessionTimer {
  const startedAtMs = useStartedAtMs();
  const pausedAtMs = usePausedAtMs();
  const pausedAccumulatedMs = usePausedAccumulatedMs();
  const completedAtMs = useCompletedAtMs();
  const status = useSessionStatus();

  const running = startedAtMs !== null && completedAtMs === null && pausedAtMs === null && status !== 'idle';

  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (!running) return undefined;
    // 1s cadence is enough for a clock and keeps the main thread free (§95).
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    setNow(Date.now());
    return () => window.clearInterval(id);
  }, [running]);

  if (startedAtMs === null) {
    return {
      elapsedMs: 0,
      elapsedLabel: formatTimer(0),
      remainingMs: timeLimitSeconds ? timeLimitSeconds * 1000 : null,
      remainingLabel: timeLimitSeconds ? formatTimer(timeLimitSeconds * 1000) : null,
      limitProgress: timeLimitSeconds ? 0 : null,
      overtime: false,
      running: false,
    };
  }

  const anchor = completedAtMs ?? pausedAtMs ?? now;
  const elapsedMs = Math.max(0, anchor - startedAtMs - pausedAccumulatedMs);
  const limitMs = timeLimitSeconds && timeLimitSeconds > 0 ? timeLimitSeconds * 1000 : null;
  const remainingMs = limitMs === null ? null : limitMs - elapsedMs;

  return {
    elapsedMs,
    elapsedLabel: formatTimer(elapsedMs),
    remainingMs,
    remainingLabel: remainingMs === null ? null : formatTimer(Math.abs(remainingMs)),
    limitProgress: limitMs === null ? null : Math.min(1, elapsedMs / limitMs),
    overtime: remainingMs !== null && remainingMs < 0,
    running,
  };
}
