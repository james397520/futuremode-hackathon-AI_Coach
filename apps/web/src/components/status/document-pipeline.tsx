import type { DocumentState } from '@ai-coach/shared';
import { Check, CircleDashed, Loader2, XCircle } from 'lucide-react';
import { DOCUMENT_PIPELINE_STEPS } from '@/lib/fixtures/knowledge';
import { cn } from '@/lib/utils';

const ORDER: DocumentState[] = [
  'uploaded',
  'validating',
  'parsing',
  'chunking',
  'embedding',
  'indexing',
  'ready',
];

/**
 * §29 Document Processing Visual — the "Action Items" checklist pattern:
 * a step counter, a thin progress bar and a tick list. Not a spinner (§44).
 */
export function DocumentPipeline({
  state,
  progress,
  failureReason,
  className,
}: {
  state: DocumentState;
  progress: number;
  failureReason?: string;
  className?: string;
}) {
  const failed = state === 'failed';
  const currentIndex = ORDER.indexOf(state);
  const doneCount = DOCUMENT_PIPELINE_STEPS.filter(
    (step) => ORDER.indexOf(step.state) <= currentIndex && currentIndex >= 0,
  ).length;

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-body-sm font-medium">文件處理</p>
        <p className="text-body-sm tabular-nums text-text-secondary">
          {failed ? '處理失敗' : `${doneCount} / ${DOCUMENT_PIPELINE_STEPS.length}`}
        </p>
      </div>

      <div
        className="h-1.5 w-full overflow-hidden rounded-pill bg-border-soft"
        role="progressbar"
        aria-valuenow={progress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="文件處理進度"
      >
        <div
          className="h-full rounded-pill transition-[width] duration-500 ease-out-soft"
          style={{
            width: `${Math.max(2, Math.min(100, progress))}%`,
            background: failed
              ? 'var(--danger)'
              : 'var(--accent-indigo)',
          }}
        />
      </div>

      <ul className="space-y-1.5">
        {DOCUMENT_PIPELINE_STEPS.map((step) => {
          const stepIndex = ORDER.indexOf(step.state);
          const done = currentIndex >= 0 && stepIndex <= currentIndex && !failed;
          const active = !failed && stepIndex === currentIndex + 1;
          const errored = failed && stepIndex === Math.max(0, currentIndex);

          return (
            <li key={step.state} className="flex items-center gap-2.5 text-body-sm">
              <span
                aria-hidden
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center',
                  done ? 'ink-success' : errored ? 'ink-danger' : active ? 'text-accent-indigo' : 'text-text-tertiary',
                )}
              >
                {done ? (
                  <Check size={13} strokeWidth={2.4} />
                ) : errored ? (
                  <XCircle size={13} strokeWidth={2} />
                ) : active ? (
                  <Loader2 size={13} strokeWidth={2} className="animate-spin" />
                ) : (
                  <CircleDashed size={13} strokeWidth={1.8} />
                )}
              </span>
              <span className={done ? 'text-text-secondary' : errored ? 'ink-danger' : 'text-text-tertiary'}>
                {step.label}
              </span>
            </li>
          );
        })}
      </ul>

      {failed && failureReason ? (
        <p className="rounded-card-sm border border-border-soft bg-glass-card px-3 py-2 text-body-sm text-text-secondary">
          <span className="meta-label ink-danger mr-2">失敗原因</span>
          {failureReason}
        </p>
      ) : null}
    </div>
  );
}
