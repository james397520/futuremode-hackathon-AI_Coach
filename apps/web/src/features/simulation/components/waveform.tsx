'use client';

/**
 * Live input waveform — spec §18 (`～～ waveform ～～`), §24, §50.
 *
 * Canvas-based and driven straight from the `AnalyserNode`, so the animation
 * runs at display rate without a single React re-render per frame (§95: 60fps
 * target, main thread kept free).
 *
 * Colours are read from the design tokens via `getComputedStyle`, so the canvas
 * follows the theme without any literal colour in this file (§99). The values
 * are re-read whenever the theme attribute changes.
 */
import { useEffect, useRef } from 'react';

import { cn } from './kit';

export interface WaveformProps {
  analyser: AnalyserNode | null;
  /** Dim the waveform when the mic is muted or the session is not listening. */
  active?: boolean;
  bars?: number;
  className?: string;
  ariaLabel?: string;
}

interface Palette {
  from: string;
  to: string;
  idle: string;
}

function readPalette(element: HTMLElement): Palette {
  const styles = getComputedStyle(element);
  const pick = (name: string, fallback: string): string => {
    const value = styles.getPropertyValue(name).trim();
    return value.length > 0 ? value : fallback;
  };
  return {
    from: pick('--accent-cyan', 'currentColor'),
    to: pick('--accent-indigo', 'currentColor'),
    idle: pick('--text-tertiary', 'currentColor'),
  };
}

export function Waveform({ analyser, active = true, bars = 48, className, ariaLabel }: WaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const context = canvas.getContext('2d');
    if (!context) return undefined;
    // `roundRect` is only in newer DOM typings — probe it instead of requiring it.
    const rounded = context as CanvasRenderingContext2D & {
      roundRect?: (x: number, y: number, w: number, h: number, r: number) => void;
    };

    let palette = readPalette(canvas);
    let frame = 0;
    let disposed = false;
    const smoothed = new Float32Array(bars);
    const buffer = analyser ? new Uint8Array(analyser.frequencyBinCount) : new Uint8Array(0);

    // Re-read tokens on theme change (light ⇄ dark) — §6 soft theme transition.
    const observer =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            palette = readPalette(canvas);
          })
        : null;
    observer?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    const resize = (): { width: number; height: number } => {
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
        context.setTransform(ratio, 0, 0, ratio, 0, 0);
      }
      return { width, height };
    };

    const draw = (): void => {
      if (disposed) return;
      const { width, height } = resize();
      context.clearRect(0, 0, width, height);

      const gap = 2;
      const barWidth = Math.max(1.5, (width - gap * (bars - 1)) / bars);
      const mid = height / 2;

      if (analyser && activeRef.current) {
        analyser.getByteFrequencyData(buffer);
        const step = Math.max(1, Math.floor(buffer.length / bars));
        for (let i = 0; i < bars; i += 1) {
          let sum = 0;
          for (let j = 0; j < step; j += 1) {
            sum += buffer[i * step + j] ?? 0;
          }
          const target = sum / step / 255;
          const previous = smoothed[i] ?? 0;
          // Fast attack, slow release — reads as speech rather than noise.
          smoothed[i] = target > previous ? previous + (target - previous) * 0.55 : previous * 0.86;
        }
      } else {
        for (let i = 0; i < bars; i += 1) {
          smoothed[i] = (smoothed[i] ?? 0) * 0.9;
        }
      }

      const gradient = context.createLinearGradient(0, 0, width, 0);
      gradient.addColorStop(0, palette.from);
      gradient.addColorStop(1, palette.to);
      context.fillStyle = activeRef.current ? gradient : palette.idle;
      context.globalAlpha = activeRef.current ? 1 : 0.35;

      for (let i = 0; i < bars; i += 1) {
        const level = smoothed[i] ?? 0;
        const barHeight = Math.max(2, level * (height - 4));
        const x = i * (barWidth + gap);
        const y = mid - barHeight / 2;
        const radius = Math.min(barWidth / 2, 2);
        context.beginPath();
        if (typeof rounded.roundRect === 'function') {
          rounded.roundRect(x, y, barWidth, barHeight, radius);
        } else {
          context.rect(x, y, barWidth, barHeight);
        }
        context.fill();
      }
      context.globalAlpha = 1;

      frame = window.requestAnimationFrame(draw);
    };

    frame = window.requestAnimationFrame(draw);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [analyser, bars]);

  return (
    <canvas
      ref={canvasRef}
      className={cn('h-full w-full', className)}
      role="img"
      aria-label={ariaLabel ?? 'Microphone input level'}
    />
  );
}
