import { cn } from '@/lib/utils';

/** Compact activity bars — the dashboard "Activity" card (§13.1). */
export function MiniBars({
  data,
  height = 110,
  ariaLabel,
  className,
}: {
  data: Array<{ label: string; value: number; secondary?: number }>;
  height?: number;
  ariaLabel: string;
  className?: string;
}) {
  const max = Math.max(1, ...data.map((entry) => entry.value));

  return (
    <figure className={cn('m-0', className)}>
      <div
        className="flex items-end gap-2"
        style={{ height }}
        role="img"
        aria-label={ariaLabel}
      >
        {data.map((entry) => {
          const total = (entry.value / max) * 100;
          const secondary = entry.secondary ? (entry.secondary / max) * 100 : 0;
          return (
            <div key={entry.label} className="flex min-w-0 flex-1 flex-col justify-end gap-0.5">
              <div className="relative w-full overflow-hidden rounded-card-sm" style={{ height: `${total}%` }}>
                <div
                  className="absolute inset-0 rounded-card-sm"
                  style={{ background: 'color-mix(in srgb, var(--accent-blue) 26%, transparent)' }}
                />
                {secondary > 0 ? (
                  <div
                    className="absolute inset-x-0 bottom-0 rounded-card-sm"
                    style={{
                      height: `${(secondary / total) * 100}%`,
                      background: 'linear-gradient(180deg, var(--accent-indigo), var(--accent-cyan))',
                      opacity: 0.85,
                    }}
                  />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <figcaption className="mt-2 flex gap-2 text-tiny text-text-tertiary">
        {data.map((entry) => (
          <span key={entry.label} className="min-w-0 flex-1 text-center">
            {entry.label}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
