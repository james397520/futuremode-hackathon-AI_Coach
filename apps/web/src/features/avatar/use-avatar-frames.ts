'use client';

/**
 * Phase-1 frame renderer — §37 (WebSocket JPEG/WebP frames), §49 (frame
 * scheduler), §17 (audio clock is the master), §62 (10-minute soak).
 *
 * The rule that shapes this whole file: **never queue**. Audio is the master
 * clock, so a frame that arrives while another is still decoding is not worth
 * catching up on — the correct behaviour is to throw the older one away and keep
 * the picture on the audio's timeline. Buffering here would trade a dropped
 * frame for permanent, growing lip-sync drift.
 *
 * Pipeline per frame:
 *   ArrayBuffer → Blob → createImageBitmap (off the main thread) → rAF draw
 *
 * Leak discipline for §62: exactly one bitmap may be pending and one displayed;
 * every bitmap that is replaced or discarded is `.close()`d, and unmounting
 * closes both. No object URLs are created, so there is nothing to revoke — that
 * is deliberate, `URL.createObjectURL` + `<img>` would leak one URL per frame
 * (90 000 over a 10-minute session at 25fps if a single revoke were missed).
 */
import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from 'react';

import type { AvatarFrameStats } from './types';

export interface UseAvatarFramesOptions {
  /** Stats are pushed at ~1Hz so the store never re-renders per frame. */
  onStats?: (stats: AvatarFrameStats) => void;
  /** Paused sinks decode nothing — used while the tab is hidden. */
  enabled?: boolean;
}

export interface AvatarFrameSink {
  canvasRef: RefObject<HTMLCanvasElement>;
  /** Feed one encoded frame straight from the socket. Never throws (§53). */
  pushFrame: (frame: ArrayBuffer) => void;
  /** Live counters; read from an animation frame, not from React state. */
  statsRef: MutableRefObject<AvatarFrameStats>;
  /** Clears the canvas and the counters (session teardown, transport switch). */
  reset: () => void;
}

const STATS_INTERVAL_MS = 1_000;

export function useAvatarFrames(options: UseAvatarFramesOptions = {}): AvatarFrameSink {
  const { onStats, enabled = true } = options;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contextRef = useRef<CanvasRenderingContext2D | null>(null);

  /** Decoded-and-waiting-to-draw. At most one; a newer frame replaces it. */
  const pendingBitmapRef = useRef<ImageBitmap | null>(null);
  /** Currently drawn; kept only so it can be closed after the next draw. */
  const drawnBitmapRef = useRef<ImageBitmap | null>(null);
  const decodingRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const enabledRef = useRef(enabled);

  const statsRef = useRef<AvatarFrameStats>({
    fps: 0,
    decodedFrames: 0,
    droppedFrames: 0,
    lastFrameAtMs: 0,
  });
  const windowStartRef = useRef(0);
  const windowFramesRef = useRef(0);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  const closeBitmap = (bitmap: ImageBitmap | null): void => {
    if (!bitmap) return;
    try {
      bitmap.close();
    } catch {
      /* Safari < 16.4 lacks close(); GC handles it there. */
    }
  };

  const draw = useCallback(() => {
    rafRef.current = null;
    const bitmap = pendingBitmapRef.current;
    if (!bitmap) return;
    pendingBitmapRef.current = null;

    const canvas = canvasRef.current;
    if (!canvas) {
      closeBitmap(bitmap);
      return;
    }

    if (!contextRef.current) {
      contextRef.current = canvas.getContext('2d', { alpha: false, desynchronized: true });
    }
    const ctx = contextRef.current;
    if (!ctx) {
      closeBitmap(bitmap);
      return;
    }

    // The runtime owns the frame size (§42 width/height); match it once so the
    // browser never rescales on the CPU path.
    if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
    }
    ctx.drawImage(bitmap, 0, 0);

    // Close the previous frame only after the new one is on the canvas.
    closeBitmap(drawnBitmapRef.current);
    drawnBitmapRef.current = bitmap;

    const now = performance.now();
    statsRef.current.decodedFrames += 1;
    statsRef.current.lastFrameAtMs = now;
    windowFramesRef.current += 1;

    if (windowStartRef.current === 0) windowStartRef.current = now;
    const elapsed = now - windowStartRef.current;
    if (elapsed >= STATS_INTERVAL_MS) {
      statsRef.current.fps = Math.round((windowFramesRef.current * 1000) / elapsed);
      windowStartRef.current = now;
      windowFramesRef.current = 0;
      onStats?.({ ...statsRef.current });
    }
  }, [onStats]);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current !== null) return;
    if (typeof requestAnimationFrame !== 'function') {
      draw();
      return;
    }
    rafRef.current = requestAnimationFrame(draw);
  }, [draw]);

  const pushFrame = useCallback(
    (frame: ArrayBuffer) => {
      if (!mountedRef.current || !enabledRef.current) return;
      if (typeof createImageBitmap !== 'function') return;

      // §49 — decode is the bottleneck. One decode in flight, ever; anything
      // that arrives meanwhile is counted as dropped and discarded.
      if (decodingRef.current) {
        statsRef.current.droppedFrames += 1;
        return;
      }
      decodingRef.current = true;

      const blob = new Blob([frame]);
      createImageBitmap(blob)
        .then((bitmap) => {
          decodingRef.current = false;
          if (!mountedRef.current || !enabledRef.current) {
            closeBitmap(bitmap);
            return;
          }
          // A bitmap still waiting to be drawn is now stale: drop it, not the new one.
          if (pendingBitmapRef.current) {
            statsRef.current.droppedFrames += 1;
            closeBitmap(pendingBitmapRef.current);
          }
          pendingBitmapRef.current = bitmap;
          scheduleDraw();
        })
        .catch(() => {
          // A corrupt frame is a dropped frame, never an error (§53).
          decodingRef.current = false;
          statsRef.current.droppedFrames += 1;
        });
    },
    [scheduleDraw],
  );

  const reset = useCallback(() => {
    closeBitmap(pendingBitmapRef.current);
    closeBitmap(drawnBitmapRef.current);
    pendingBitmapRef.current = null;
    drawnBitmapRef.current = null;
    decodingRef.current = false;
    statsRef.current = { fps: 0, decodedFrames: 0, droppedFrames: 0, lastFrameAtMs: 0 };
    windowStartRef.current = 0;
    windowFramesRef.current = 0;

    const canvas = canvasRef.current;
    const ctx = contextRef.current;
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    onStats?.({ ...statsRef.current });
  }, [onStats]);

  /**
   * Idle detection: if frames stop but the socket stays open, fps must fall to 0
   * rather than freeze at its last reading, or the badge lies to an admin.
   */
  useEffect(() => {
    const timer = setInterval(() => {
      const last = statsRef.current.lastFrameAtMs;
      if (last === 0 || statsRef.current.fps === 0) return;
      if (performance.now() - last > STATS_INTERVAL_MS * 2) {
        statsRef.current.fps = 0;
        windowStartRef.current = 0;
        windowFramesRef.current = 0;
        onStats?.({ ...statsRef.current });
      }
    }, STATS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [onStats]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (rafRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      closeBitmap(pendingBitmapRef.current);
      closeBitmap(drawnBitmapRef.current);
      pendingBitmapRef.current = null;
      drawnBitmapRef.current = null;
      contextRef.current = null;
    };
  }, []);

  return { canvasRef, pushFrame, statsRef, reset };
}
