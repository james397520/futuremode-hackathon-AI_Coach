import { cn, titleize } from '@/lib/utils';

/**
 * §35 Part I — weakness heatmap / skill matrix.
 * Implemented as a real <table> so it is readable by screen readers and never a
 * Bootstrap-style grid of borders (§99). Each cell shows its number.
 */
export function SkillHeatmap({
  columns,
  rows,
  className,
}: {
  columns: string[];
  rows: Array<{ id: string; label: string; values: number[] }>;
  className?: string;
}) {
  const cellStyle = (value: number) => {
    // Low score → warmer tint, high score → mint tint. Small area, low saturation.
    const token = value >= 80 ? 'var(--success)' : value >= 70 ? 'var(--accent-blue)' : value >= 60 ? 'var(--warning)' : 'var(--danger)';
    const strength = value >= 80 ? 18 : value >= 70 ? 14 : value >= 60 ? 20 : 26;
    return { background: `color-mix(in srgb, ${token} ${strength}%, transparent)` };
  };

  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full border-separate border-spacing-1 text-body-sm">
        <caption className="sr-only-live">Skill matrix by team. Lower numbers indicate a weaker skill.</caption>
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 bg-transparent px-2 text-left text-tiny font-medium text-text-tertiary">
              Team
            </th>
            {columns.map((column) => (
              <th
                key={column}
                scope="col"
                className="px-1.5 pb-1 text-center text-tiny font-medium text-text-tertiary"
              >
                <span className="block max-w-[74px] truncate" title={titleize(column)}>
                  {titleize(column)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <th scope="row" className="whitespace-nowrap px-2 text-left text-body-sm font-medium">
                {row.label}
              </th>
              {row.values.map((value, index) => (
                <td
                  key={`${row.id}-${columns[index] ?? index}`}
                  className="rounded-card-sm px-1.5 py-2 text-center tabular-nums"
                  style={cellStyle(value)}
                >
                  {value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
