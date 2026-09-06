import { titleize } from '@/lib/utils';

/** Axis-label type size, and how far past the outer ring the labels sit. */
const LABEL_FONT = 9.5;
const LABEL_RADIUS = 1.16;

export interface RadarSeries {
  id: string;
  label: string;
  /** Token variable, e.g. `var(--accent-indigo)`. */
  color: string;
  values: number[];
}

/**
 * §38 — exactly ONE radar chart per report page. Everything else is bars or a
 * line trend. Axes are labelled, values are also listed in a table beneath by
 * the consuming page so the chart is never the only representation (§47).
 */
export function SkillRadar({
  axes,
  series,
  size = 300,
  max = 100,
}: {
  axes: string[];
  series: RadarSeries[];
  size?: number;
  max?: number;
}) {
  const count = axes.length;
  if (count < 3) return null;

  const center = size / 2;
  const radius = center - 46;
  const rings = [0.25, 0.5, 0.75, 1];

  // Axis labels are drawn outside the last ring, so a long one ("Communication",
  // 74 px at 9.5 px) runs past a square viewBox and is clipped by the SVG
  // viewport — the word simply ends mid-letter. Widen the box by what the
  // longest label actually needs instead of shrinking the chart to fit its
  // longest word: the geometry is unchanged, only the canvas around it grows.
  const labelText = (axis: string) => titleize(axis).split(' ')[0] ?? '';
  // No text measurement in SVG before paint; CJK is full-width, Latin ~0.58 em.
  const labelWidth = (text: string) =>
    [...text].reduce(
      (w, ch) => w + (/[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(ch) ? LABEL_FONT : LABEL_FONT * 0.58),
      0,
    );
  const widestLabel = Math.max(0, ...axes.map((axis) => labelWidth(labelText(axis))));
  const padX = Math.max(0, Math.ceil(center + radius * LABEL_RADIUS - size + widestLabel) + 6);
  const boxWidth = size + padX * 2;

  const pointAt = (index: number, ratio: number) => {
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
    return {
      x: center + Math.cos(angle) * radius * ratio,
      y: center + Math.sin(angle) * radius * ratio,
    };
  };

  const polygon = (values: number[]) =>
    values
      .map((value, index) => {
        const ratio = Math.max(0, Math.min(1, value / max));
        const { x, y } = pointAt(index, ratio);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  return (
    <figure className="m-0 flex flex-col items-center gap-3">
      <svg
        viewBox={`${-padX} 0 ${boxWidth} ${size}`}
        width="100%"
        style={{ maxWidth: boxWidth }}
        role="img"
        aria-label={`${count} 項技能雷達圖，比較 ${series.map((s) => s.label).join('與')}`}
      >
        {rings.map((ring) => (
          <polygon
            key={ring}
            className="chart-grid-line"
            fill="none"
            points={axes
              .map((_, index) => {
                const { x, y } = pointAt(index, ring);
                return `${x.toFixed(1)},${y.toFixed(1)}`;
              })
              .join(' ')}
          />
        ))}

        {axes.map((axis, index) => {
          const { x, y } = pointAt(index, 1);
          const labelPoint = pointAt(index, LABEL_RADIUS);
          return (
            <g key={axis}>
              <line x1={center} y1={center} x2={x} y2={y} className="chart-grid-line" />
              <text
                x={labelPoint.x}
                y={labelPoint.y}
                textAnchor={labelPoint.x > center + 4 ? 'start' : labelPoint.x < center - 4 ? 'end' : 'middle'}
                dominantBaseline="middle"
                style={{ fill: 'var(--text-tertiary)', fontSize: LABEL_FONT, letterSpacing: '0.02em' }}
              >
                {titleize(axis).split(' ')[0]}
              </text>
            </g>
          );
        })}

        {series.map((entry) => (
          <g key={entry.id}>
            <polygon
              points={polygon(entry.values)}
              style={{ fill: entry.color, fillOpacity: 0.16, stroke: entry.color, strokeWidth: 1.6 }}
            />
            {entry.values.map((value, index) => {
              const { x, y } = pointAt(index, Math.max(0, Math.min(1, value / max)));
              return <circle key={index} cx={x} cy={y} r={2.4} style={{ fill: entry.color }} />;
            })}
          </g>
        ))}
      </svg>

      <figcaption className="flex flex-wrap items-center justify-center gap-3 text-tiny text-text-secondary">
        {series.map((entry) => (
          <span key={entry.id} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-2 w-2 rounded-pill"
              style={{ background: entry.color }}
            />
            {entry.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
