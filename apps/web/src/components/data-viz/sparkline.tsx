/** Tiny inline trend for KPI tiles. Decorative — always paired with a number. */
export function Sparkline({ values, width = 84, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;

  const path = values
    .map((value, index) => {
      const x = (index * width) / (values.length - 1);
      const y = height - ((value - lo) / span) * (height - 4) - 2;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden focusable="false">
      <path
        d={path}
        fill="none"
        style={{ stroke: 'var(--accent-cyan)', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }}
      />
    </svg>
  );
}
