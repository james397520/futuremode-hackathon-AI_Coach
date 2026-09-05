'use client';

/**
 * Runtime label — §50 ("the web does not know about MLX / CUDA / TensorRT;
 * only Admin sees the backend") and §93 plain language.
 *
 * A trainee sees one honest, jargon-free phrase:
 *   ready       → "Local AI · GPU accelerated"
 *   loading     → "Preparing customer…"
 *   degraded    → "Reduced video quality"
 *   unavailable → "Portrait mode" (NOT "error" — nothing is broken, §53)
 *
 * An admin (`runtime.view_telemetry`) additionally gets the engineering row:
 * backend id, measured fps, A/V drift, dropped frames and the last §76 code.
 * That detail is rendered from the same store the trainee label reads, so the
 * two can never disagree.
 */
import { useAvatarStore } from '../avatar-store';
import { useCan } from '@/lib/auth-context';
import { cn, onMediaSurface, tint, toneText, toneVar, type ToneKey } from '../lib/tone';
import type { AvatarRuntimeStatus } from '../types';
import { AvatarStyles } from './avatar-styles';

export interface RuntimeBadgeProps {
  className?: string;
  /** Compact form drops the detail row even for admins (used on the small card). */
  compact?: boolean;
  /**
   * Rendered over the persona portrait rather than on glass: ink scrim +
   * `--text-on-media`, with the tone carried by the dot. The glass chip's toned
   * text has no guaranteed contrast over a photo.
   */
  onMedia?: boolean;
}

interface Label {
  text: string;
  tone: ToneKey;
}

function traineeLabel(status: AvatarRuntimeStatus, backend: string | null): Label {
  switch (status) {
    case 'ready':
      return { text: acceleratedLabel(backend), tone: 'mint' };
    case 'loading':
      return { text: '正在準備客戶影像…', tone: 'indigo' };
    case 'checking':
      return { text: '正在檢查視訊…', tone: 'neutral' };
    case 'degraded':
      return { text: '視訊畫質降低', tone: 'warning' };
    case 'unavailable':
      return { text: '靜態頭像模式', tone: 'neutral' };
    case 'unknown':
    default:
      return { text: '靜態頭像模式', tone: 'neutral' };
  }
}

/**
 * The backend id is engineering vocabulary; the trainee gets the *consequence*.
 * Anything GPU-backed is "GPU accelerated"; a CPU build says so plainly rather
 * than pretending.
 */
function acceleratedLabel(backend: string | null): string {
  if (!backend) return '本機 AI';
  const id = backend.toLowerCase();
  if (id.includes('cpu')) return '本機 AI · CPU';
  return '本機 AI · GPU 加速';
}

export function RuntimeBadge({ className, compact = false, onMedia = false }: RuntimeBadgeProps) {
  const status = useAvatarStore((s) => s.status);
  const backend = useAvatarStore((s) => s.backend);
  const frames = useAvatarStore((s) => s.frames);
  const drift = useAvatarStore((s) => s.avDriftMs);
  const capabilities = useAvatarStore((s) => s.capabilities);
  const lastError = useAvatarStore((s) => s.lastError);
  const degradedComponent = useAvatarStore((s) => s.degradedComponent);
  const canSeeTelemetry = useCan('runtime.view_telemetry');

  const label = traineeLabel(status, backend);
  const showDetail = canSeeTelemetry && !compact && status !== 'unknown';

  const dotColor = onMedia
    ? label.tone === 'neutral'
      ? 'var(--text-on-media)'
      : toneVar(label.tone)
    : toneText(label.tone);

  return (
    <div className={cn('flex min-w-0 flex-col items-start gap-1', className)}>
      {/* The badge is mounted on its own on the settings and setup pages, so it
          carries the stylesheet its pulse class and AA tone mixes come from. */}
      <AvatarStyles />
      <span
        className={cn(
          'inline-flex max-w-full items-center gap-1.5 truncate rounded-pill px-2 py-0.5 text-tiny backdrop-blur',
          !onMedia && 'border',
        )}
        style={
          onMedia
            ? onMediaSurface()
            : {
                backgroundColor: tint(label.tone, 14),
                borderColor: tint(label.tone, 28),
                color: toneText(label.tone),
              }
        }
      >
        <span
          aria-hidden="true"
          className={cn(
            'inline-block size-1.5 shrink-0 rounded-pill',
            status === 'loading' || status === 'checking' ? 'avatar-speak-pulse' : undefined,
          )}
          style={{ backgroundColor: dotColor }}
        />
        <span className="truncate">{label.text}</span>
      </span>

      {showDetail ? (
        <span
          className="truncate text-tiny"
          style={{ color: 'var(--text-tertiary)' }}
          // Engineering detail is supplementary; screen readers get the plain
          // label above and this row only on demand.
          title={lastError ? `${lastError.code}: ${lastError.message}` : undefined}
        >
          {[
            backend ?? 'no backend',
            capabilities ? `cap ${capabilities.max_recommended_fps}fps` : null,
            `${frames.fps}fps`,
            `drift ${Math.round(drift)}ms`,
            `drop ${frames.droppedFrames}`,
            degradedComponent ? `degraded: ${degradedComponent}` : null,
            lastError ? lastError.code : null,
          ]
            .filter((part): part is string => typeof part === 'string')
            .join(' · ')}
        </span>
      ) : null}
    </div>
  );
}
