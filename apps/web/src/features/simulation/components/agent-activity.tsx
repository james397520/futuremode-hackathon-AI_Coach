'use client';

/**
 * Which of the seven agents is working — spec §19 (agent names), §44 (`✦ Thinking…`
 * gradient pill), §93 (a normal user sees one plain line, not an engineering dump).
 *
 * Deliberately one line. No agent graph, no token counts, no latency numbers:
 * that detail belongs in Settings → AI Runtime for administrators (§93).
 */
import { useEffect, useState } from 'react';
import type { AgentName, SessionState } from '@ai-coach/shared-types';

import { AGENT_LABEL } from '../lib/labels';
import { toneText } from '../lib/tone';
import { LiveDot } from './atoms';
import { SparkleIcon } from './icons';
import { cn } from './kit';

export interface AgentActivityProps {
  agent: AgentName | null;
  /** `at_ms` of the last `agent.thinking` event. */
  atMs: number;
  status: SessionState;
  /** Hide the line this long after the last signal. */
  linger?: number;
  className?: string;
}

export function AgentActivity({ agent, atMs, status, linger = 2600, className }: AgentActivityProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!agent) {
      setVisible(false);
      return undefined;
    }
    setVisible(true);
    const id = window.setTimeout(() => setVisible(false), linger);
    return () => window.clearTimeout(id);
  }, [agent, atMs, linger]);

  const thinking = status === 'processing' || status === 'transcribing';
  const show = Boolean(agent) && (visible || thinking);

  return (
    <div
      className={cn(
        'flex h-5 items-center gap-2 overflow-hidden transition-opacity duration-200',
        show ? 'opacity-100' : 'opacity-0',
        className,
      )}
      aria-live="polite"
    >
      {agent ? (
        <>
          <LiveDot tone="indigo" pulsing />
          <SparkleIcon size={12} style={{ color: toneText('indigo') }} />
          <span className="truncate text-tiny text-text-tertiary">
            {AGENT_LABEL[agent] ?? 'Working'}…
          </span>
        </>
      ) : null}
    </div>
  );
}
