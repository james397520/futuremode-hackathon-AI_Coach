'use client';

/**
 * Two small dialogs the §24 control set requires: `Transcript` and
 * `Report Issue`. Both are token-styled glass modals, both keep the session
 * running behind them.
 */
import { useState } from 'react';
import type { ChangeEvent } from 'react';
import type { Citation } from '@ai-coach/shared';

import { formatClock } from '../lib/format';
import { SPEAKER_LABEL } from '../lib/labels';
import { insetSurface, toneText } from '../lib/tone';
import { CitationList } from './citation-chip';
import { DownloadIcon, FlagIcon, TranscriptIcon } from './icons';
import { cn, Modal, Textarea } from './kit';
import type { TranscriptItem } from './transcript-turn';

export interface TranscriptDialogProps {
  open: boolean;
  onClose: () => void;
  items: TranscriptItem[];
  startedAtMs: number | null;
  personaName: string;
  traineeName?: string;
  onCopy: () => void;
  onDownload: () => void;
}

export function TranscriptDialog({
  open,
  onClose,
  items,
  startedAtMs,
  personaName,
  traineeName = 'You',
  onCopy,
  onDownload,
}: TranscriptDialogProps) {
  const [copied, setCopied] = useState(false);

  const nameFor = (item: TranscriptItem): string => {
    if (item.turn.speaker === 'persona') return personaName;
    if (item.turn.speaker === 'trainee') return traineeName;
    return SPEAKER_LABEL[item.turn.speaker] ?? item.turn.speaker;
  };

  return (
    <Modal open={open} onClose={onClose} title="Transcript">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              onCopy();
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            }}
            className="sim-focusable flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-meta"
            style={insetSurface('blue', 12)}
          >
            <TranscriptIcon size={13} style={{ color: toneText('blue') }} />
            <span style={{ color: toneText('blue') }}>{copied ? 'Copied' : 'Copy as Markdown'}</span>
          </button>
          <button
            type="button"
            onClick={onDownload}
            className="sim-focusable flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-meta"
            style={insetSurface('neutral', 10)}
          >
            <DownloadIcon size={13} />
            Download
          </button>
          <span className="ml-auto text-tiny text-text-tertiary">{items.length} entries</span>
        </div>

        <div className={cn('sim-scroll max-h-[60vh] overflow-y-auto rounded-card border p-4')} style={insetSurface('neutral', 6)}>
          {items.length === 0 ? (
            <p className="text-body-sm text-text-tertiary">Nothing has been said yet.</p>
          ) : (
            <ol className="grid gap-4">
              {items.map((item) => (
                <li key={`dialog-${item.id}`} className="grid gap-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-body-sm font-semibold text-text-primary">{nameFor(item)}</span>
                    <span className="text-tiny tabular-nums text-text-tertiary">
                      {formatClock(startedAtMs === null ? item.atMs : Math.max(0, item.atMs - startedAtMs))}
                    </span>
                  </div>
                  <p className="sim-transcript-body text-body-sm">
                    {item.streaming ? (item.streamingText ?? '') : item.turn.text}
                  </p>
                  {item.turn.citations?.length ? (
                    <CitationList citations={item.turn.citations} className="mt-1" />
                  ) : null}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export interface ReportIssueDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (report: { category: string; detail: string }) => void;
}

const CATEGORIES = [
  'The persona broke character',
  'The answer was factually wrong',
  'Audio or microphone problem',
  'Scoring looks wrong',
  'Something else',
] as const;

export function ReportIssueDialog({ open, onClose, onSubmit }: ReportIssueDialogProps) {
  const [category, setCategory] = useState<string>(CATEGORIES[0] ?? 'Something else');
  const [detail, setDetail] = useState('');
  const [sent, setSent] = useState(false);

  const submit = (): void => {
    onSubmit({ category, detail: detail.trim() });
    setSent(true);
    setDetail('');
    window.setTimeout(() => {
      setSent(false);
      onClose();
    }, 1200);
  };

  return (
    <Modal open={open} onClose={onClose} title="Report an issue">
      <div className="grid gap-3">
        <p className="text-body-sm text-text-secondary">
          Your report is attached to this session so a reviewer can replay the exact moment.
        </p>

        <div className="grid gap-2">
          {CATEGORIES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setCategory(option)}
              aria-pressed={category === option}
              className="sim-focusable rounded-card-sm border px-3 py-2 text-left text-body-sm text-text-primary"
              style={insetSurface(category === option ? 'blue' : 'neutral', category === option ? 13 : 7)}
            >
              {option}
            </button>
          ))}
        </div>

        <Textarea
          value={detail}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => setDetail(event.target.value)}
          rows={4}
          maxLength={1000}
          placeholder="What happened? (optional)"
          aria-label="Issue detail"
          className="sim-scroll w-full resize-none rounded-input border-border-soft bg-transparent p-3 text-body text-text-primary placeholder:text-text-tertiary focus:outline-none"
        />

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="sim-focusable rounded-input px-4 py-2 text-body text-text-secondary"
            style={insetSurface('neutral', 9)}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={sent}
            className="sim-focusable flex items-center gap-2 rounded-input px-4 py-2 text-body font-medium disabled:opacity-60"
            style={{
              background: 'linear-gradient(120deg, var(--accent-indigo), var(--accent-blue))',
              color: 'var(--bg-canvas-soft)',
            }}
          >
            <FlagIcon size={15} />
            {sent ? 'Sent' : 'Send report'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------

export interface KnowledgeReferenceDialogProps {
  open: boolean;
  onClose: () => void;
  /** Every citation the session has produced so far, newest first. */
  citations: Citation[];
}

/**
 * §24 `View Knowledge Reference` — Training Mode only. The page does not render
 * this dialog at all in Assessment Mode (§8.4 "Knowledge Peek" is a cheat
 * affordance), so there is no hidden element to unhide.
 */
export function KnowledgeReferenceDialog({ open, onClose, citations }: KnowledgeReferenceDialogProps) {
  return (
    <Modal open={open} onClose={onClose} title="Knowledge reference">
      <div className="grid gap-3">
        <p className="text-body-sm text-text-secondary">
          Approved material the knowledge agent has retrieved during this session. Every claim traces
          back to a document version, page and section.
        </p>
        <div className="sim-scroll max-h-[60vh] overflow-y-auto">
          {citations.length === 0 ? (
            <p className="text-body-sm text-text-tertiary">
              Nothing retrieved yet — sources appear as the conversation touches the knowledge base.
            </p>
          ) : (
            <CitationList citations={citations} />
          )}
        </div>
      </div>
    </Modal>
  );
}
