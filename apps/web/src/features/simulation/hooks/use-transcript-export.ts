'use client';

/**
 * Transcript export (§24 `Transcript`, §25 message fields).
 * Produces the meeting-minutes rendering of the session: speaker, timecode,
 * paragraph, plus intent / citations / compliance annotations.
 */
import { useCallback, useMemo } from 'react';
import type { TranscriptTurn } from '@ai-coach/shared';

import { formatClock, humaniseSlug } from '../lib/format';
import { COMPLIANCE_TYPE_LABEL, SPEAKER_LABEL } from '../lib/labels';
import {
  useBootstrap,
  useComplianceFindings,
  useSessionStore,
  useStartedAtMs,
  useTurns,
} from '../store/session-store';

export interface TranscriptExport {
  toMarkdown: () => string;
  toPlainText: () => string;
  copy: () => Promise<boolean>;
  download: (format?: 'md' | 'txt') => void;
  turnCount: number;
}

function relative(turn: TranscriptTurn, startedAtMs: number | null): string {
  if (startedAtMs === null) return formatClock(turn.timestamp_ms);
  return formatClock(Math.max(0, turn.timestamp_ms - startedAtMs));
}

export function useTranscriptExport(): TranscriptExport {
  const turns = useTurns();
  const startedAtMs = useStartedAtMs();
  const bootstrap = useBootstrap();
  const findings = useComplianceFindings();
  const sessionId = useSessionStore((s) => s.sessionId);

  const header = useMemo(() => {
    const scenario = bootstrap?.scenario.name ?? '即時模擬練習';
    const persona = bootstrap?.persona.name ?? 'AI 模擬人物';
    const mode = bootstrap?.mode === 'assessment' ? '評測' : '訓練';
    return { scenario, persona, mode };
  }, [bootstrap]);

  const toMarkdown = useCallback((): string => {
    const lines: string[] = [
      `# ${header.scenario}`,
      '',
      `- 客戶：${header.persona}`,
      `- 模式：${header.mode}`,
      `- 練習編號：${sessionId}`,
      `- 回合數：${turns.length}`,
      '',
      '## 逐字稿',
      '',
    ];

    for (const turn of turns) {
      const who = SPEAKER_LABEL[turn.speaker] ?? turn.speaker;
      lines.push(`**${who}** · ${relative(turn, startedAtMs)}`);
      lines.push('');
      lines.push(turn.text.trim());
      if (turn.intent) lines.push(`> 意圖：${humaniseSlug(turn.intent)}`);
      if (turn.citations?.length) {
        for (const c of turn.citations) {
          const page = c.page ? ` p.${c.page}` : '';
          lines.push(`> 來源：${c.document_name} v${c.document_version}${page}`);
        }
      }
      lines.push('');
    }

    if (findings.length > 0) {
      lines.push('## 合規檢查結果', '');
      for (const f of findings) {
        lines.push(
          `- [${f.severity}] ${COMPLIANCE_TYPE_LABEL[f.type] ?? f.type} @ ${formatClock(
            startedAtMs === null ? f.timestamp_ms : Math.max(0, f.timestamp_ms - startedAtMs),
          )} — ${f.explanation}`,
        );
      }
      lines.push('');
    }

    return lines.join('\n');
  }, [findings, header, sessionId, startedAtMs, turns]);

  const toPlainText = useCallback((): string => {
    return turns
      .map((turn) => {
        const who = SPEAKER_LABEL[turn.speaker] ?? turn.speaker;
        return `[${relative(turn, startedAtMs)}] ${who}: ${turn.text.trim()}`;
      })
      .join('\n\n');
  }, [startedAtMs, turns]);

  const copy = useCallback(async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(toMarkdown());
      return true;
    } catch {
      return false;
    }
  }, [toMarkdown]);

  const download = useCallback(
    (format: 'md' | 'txt' = 'md') => {
      try {
        const body = format === 'md' ? toMarkdown() : toPlainText();
        const blob = new Blob([body], { type: format === 'md' ? 'text/markdown' : 'text/plain' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = `transcript-${sessionId || 'session'}.${format}`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      } catch {
        // Export is a convenience; a blocked download must not break the session.
      }
    },
    [sessionId, toMarkdown, toPlainText],
  );

  return { toMarkdown, toPlainText, copy, download, turnCount: turns.length };
}
