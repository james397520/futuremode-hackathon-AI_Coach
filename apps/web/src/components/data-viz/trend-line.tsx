import { cn } from '@/lib/utils';

export interface TrendPoint {
  label: string;
  value: number;
}

/** §38 — one restrained line trend. No area gradients, no dual axes. */
export function TrendLine({
  points,
  height = 148,
  min,
  max,
  suffix = '',
  ariaLabel,
  className,
}: {
  points: TrendPoint[];
  height?: number;
  min?: number;
  max?: number;
  suffix?: string;
  ariaLabel: string;
  className?: string;
}) {
  if (points.length < 2) return null;

  const width = 520;
  const padX = 8;
  const padY = 16;
  const values = points.map((point) => point.value);
  const lo = min ?? Math.min(...values) - 4;
  const hi = max ?? Math.max(...values) + 4;
  const span = hi - lo || 1;

  const coords = points.map((point, index) => {
    const x = padX + (index * (width - padX * 2)) / (points.length - 1);
    const y = padY + (1 - (point.value - lo) / span) * (height - padY * 2);
    return { ...point, x, y };
  });

  const path = coords
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`)
    .join(' ');

  const last = coords[coords.length - 1]!;

  return (
    <figure className={cn('m-0', className)}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" role="img" aria-label={ariaLabel}>
        {[0, 0.5, 1].map((ratio) => (
          <line
            key={ratio}
            x1={padX}
            x2={width - padX}
            y1={padY + ratio * (height - padY * 2)}
            y2={padY + ratio * (height - padY * 2)}
            className="chart-grid-line"
          />
        ))}
        <path
          d={path}
          fill="none"
          style={{ stroke: 'var(--accent-indigo)', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' }}
        />
        {coords.map((point) => (
          <circle
            key={point.label}
            cx={point.x}
            cy={point.y}
            r={2.8}
            style={{ fill: 'var(--bg-canvas-soft)', stroke: 'var(--accent-indigo)', strokeWidth: 1.6 }}
          />
        ))}
        <text
          x={last.x}
          y={Math.max(padY - 4, last.y - 10)}
          textAnchor="end"
          style={{ fill: 'var(--text-secondary)', fontSize: 11, fontWeight: 600 }}
        >
          {`${last.value}${suffix}`}
        </text>
      </svg>
      <figcaption className="mt-1 flex justify-between text-tiny text-text-tertiary">
        {points.map((point) => (
          <span key={point.label}>{point.label}</span>
        ))}
      </figcaption>
    </figure>
  );
}
