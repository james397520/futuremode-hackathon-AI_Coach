import type { Citation } from '@ai-coach/shared-types';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * §12.5 — every knowledge claim is traceable. Similarity and rerank score are
 * both shown because they disagree often and the difference is the point.
 */
export function CitationList({
  citations,
  className,
  showScores = true,
}: {
  citations: Citation[];
  className?: string;
  showScores?: boolean;
}) {
  if (citations.length === 0) return null;

  return (
    <ul className={cn('flex flex-col gap-1.5', className)}>
      {citations.map((citation) => (
        <li
          key={citation.chunk_id}
          className="glass-strong flex items-start gap-2.5 rounded-card-sm px-3 py-2"
        >
          <FileText size={14} strokeWidth={1.7} aria-hidden className="mt-0.5 shrink-0 text-text-tertiary" />
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-tiny text-text-tertiary">
              <span className="font-medium text-text-secondary">{citation.document_name}</span>
              <span>v{citation.document_version}</span>
              {citation.page !== undefined ? <span>p.{citation.page}</span> : null}
              {citation.section ? <span className="truncate">{citation.section}</span> : null}
              {showScores ? (
                <span className="tabular-nums">
                  sim {citation.similarity.toFixed(2)}
                  {citation.rerank_score !== undefined ? ` · rerank ${citation.rerank_score.toFixed(2)}` : ''}
                </span>
              ) : null}
            </p>
            <p className="mt-1 text-body-sm text-text-secondary">{citation.snippet}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
