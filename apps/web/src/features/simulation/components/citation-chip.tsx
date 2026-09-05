'use client';

/**
 * Knowledge citation chip — spec §17 (`Source · Product Manual p.12`) and
 * §12.5 (source document / version / page / section / chunk id / retrieval score).
 *
 * Collapsed it is a quiet one-line source tag under the transcript paragraph.
 * Expanded it shows the full provenance plus the retrieved snippet, so every
 * knowledge claim in the conversation is traceable without leaving the page.
 */
import { useState } from 'react';
import type { Citation } from '@ai-coach/shared';

import { formatSimilarity } from '../lib/format';
import { insetSurface, tint, toneText } from '../lib/tone';
import { BookIcon, ChevronDownIcon, ChevronRightIcon } from './icons';
import { cn } from './kit';

export interface CitationChipProps {
  citation: Citation;
  /** Renders open on first paint (used by the knowledge slide-over). */
  defaultOpen?: boolean;
  className?: string;
}

export function CitationChip({ citation, defaultOpen = false, className }: CitationChipProps) {
  const [open, setOpen] = useState(defaultOpen);
  // Bare number: the label in front of it already says 頁碼, so a `p.` prefix
  // read as "頁碼 p.12".
  const page = citation.page ? String(citation.page) : null;
  const summary = [citation.document_name, page].filter(Boolean).join(' · ');

  return (
    <div className={cn('min-w-0', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="sim-focusable inline-flex max-w-full items-center gap-1.5 rounded-pill px-2.5 py-1 text-tiny transition-colors"
        style={insetSurface('cyan', open ? 16 : 10)}
      >
        <BookIcon size={12} style={{ color: toneText('cyan') }} />
        <span className="text-text-tertiary">來源</span>
        <span className="truncate" style={{ color: toneText('cyan') }}>
          {summary}
        </span>
        {open ? (
          <ChevronDownIcon size={12} className="text-text-tertiary" />
        ) : (
          <ChevronRightIcon size={12} className="text-text-tertiary" />
        )}
      </button>

      {open ? (
        <div
          className="sim-marker-pop mt-2 grid gap-2.5 rounded-card-sm border p-3.5"
          style={insetSurface('cyan', 8)}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-tiny text-text-tertiary">
            <span>
              版本 <span className="text-text-secondary">v{citation.document_version}</span>
            </span>
            {citation.section ? (
              <span>
                章節 <span className="text-text-secondary">{citation.section}</span>
              </span>
            ) : null}
            {page ? (
              <span>
                頁碼 <span className="text-text-secondary">{page}</span>
              </span>
            ) : null}
            <span>
              Similarity{' '}
              <span className="tabular-nums text-text-secondary">
                {formatSimilarity(citation.similarity)}
              </span>
            </span>
            {typeof citation.rerank_score === 'number' ? (
              <span>
                Rerank{' '}
                <span className="tabular-nums text-text-secondary">
                  {formatSimilarity(citation.rerank_score)}
                </span>
              </span>
            ) : null}
          </div>

          <blockquote
            className="rounded-card-sm border-l-2 pl-3 text-body-sm text-text-secondary"
            style={{ borderColor: tint('cyan', 44) }}
          >
            {citation.snippet}
          </blockquote>

          <div className="text-tiny text-text-tertiary">
            片段 <span className="tabular-nums">{citation.chunk_id}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export interface CitationListProps {
  citations: Citation[];
  className?: string;
}

export function CitationList({ citations, className }: CitationListProps) {
  if (citations.length === 0) return null;
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {citations.map((citation) => (
        <CitationChip key={`${citation.chunk_id}-${citation.document_version}`} citation={citation} />
      ))}
    </div>
  );
}
