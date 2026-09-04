import Link from 'next/link';
import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Breadcrumb + title + description + actions slot.
 * Used by every page so the workspace column has one consistent header rhythm
 * (§8 spacing, §7 typography). Actions are a slot, not a fixed set of buttons.
 */
export function PageHeader({
  breadcrumbs,
  title,
  description,
  actions,
  meta,
  className,
}: {
  breadcrumbs?: Crumb[];
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Small pills / counters rendered under the title. */
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-4 pb-6 pt-1', className)}>
      <div className="min-w-0 flex-1">
        {breadcrumbs && breadcrumbs.length > 0 ? (
          <nav aria-label="Breadcrumb" className="mb-2">
            <ol className="flex flex-wrap items-center gap-1 text-meta text-text-tertiary">
              {breadcrumbs.map((crumb, index) => {
                const isLast = index === breadcrumbs.length - 1;
                return (
                  <li key={`${crumb.label}-${index}`} className="flex items-center gap-1">
                    {crumb.href && !isLast ? (
                      <Link href={crumb.href} className="rounded-button hover:text-text-secondary">
                        {crumb.label}
                      </Link>
                    ) : (
                      <span aria-current={isLast ? 'page' : undefined} className={isLast ? 'text-text-secondary' : undefined}>
                        {crumb.label}
                      </span>
                    )}
                    {!isLast ? <ChevronRight size={13} strokeWidth={1.8} aria-hidden /> : null}
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : null}

        <h1 className="text-page-title">{title}</h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-body text-text-secondary">{description}</p>
        ) : null}
        {meta ? <div className="mt-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>

      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
