'use client';

/**
 * Emotion badge in the reference design language: a thick indigo ring with a
 * mint arc travelling around it, and two mint eyes inside.
 *
 * The motion is the point. In the reference the mint segment **orbits** the
 * ring continuously — it is not a static pair of brows (which is how a single
 * still frame reads, and how this was first built). Each emotion differs in how
 * much of the ring the segment covers and how fast it travels; the eyes carry
 * the rest of the expression and stay put.
 *
 * The emotion is therefore never conveyed by colour alone (§47): arc length,
 * orbit speed and eye shape all change, and the name is printed underneath.
 *
 * Colours come from the accent tokens rather than the reference's literals. The
 * badge sits on arbitrary webcam video, so it carries its own light disc — the
 * reference's near-white card, without which indigo-on-dark loses the shape.
 */
import type { AffectLabel } from '../lib/affect';
import { cn } from './kit';

const RING = 'var(--accent-indigo)';
const FEATURE = 'var(--accent-cyan)';

const CX = 50;
const CY = 50;
const R = 37;
const RING_WIDTH = 13;
const CIRCUMFERENCE = 2 * Math.PI * R;

/** Polar → cartesian on the ring. 0° is 12 o'clock, growing clockwise. */
function point(deg: number, radius = R): [number, number] {
  const rad = ((deg - 90) * Math.PI) / 180;
  return [CX + radius * Math.cos(rad), CY + radius * Math.sin(rad)];
}

type EyeShape =
  | { kind: 'arc' }
  | { kind: 'dot'; r?: number }
  | { kind: 'capsule'; w?: number; h?: number; tilt?: number };

interface FaceSpec {
  /** How much of the ring the travelling mint segment covers, in degrees. */
  arcDeg: number;
  /** Seconds per orbit. Faster reads as more aroused. */
  orbitS: number;
  eye: EyeShape;
  /** A second dot riding the ring opposite the arc (surprised / sad). */
  dot?: { deg: number; r?: number };
  /** Mirror the right eye instead of copying it — the one-sided smirk. */
  asymmetric?: boolean;
}

const FACES: Record<AffectLabel, FaceSpec> = {
  happy: { arcDeg: 150, orbitS: 6, eye: { kind: 'arc' } },
  surprised: { arcDeg: 95, orbitS: 3.2, eye: { kind: 'capsule', w: 8, h: 24 }, dot: { deg: 180, r: 6 } },
  sad: { arcDeg: 170, orbitS: 11, eye: { kind: 'dot', r: 5.5 }, dot: { deg: 205, r: 5 } },
  angry: { arcDeg: 62, orbitS: 3.6, eye: { kind: 'capsule', w: 8, h: 11, tilt: 24 } },
  fearful: { arcDeg: 110, orbitS: 2.6, eye: { kind: 'capsule', w: 9, h: 20 } },
  disgusted: { arcDeg: 54, orbitS: 5, eye: { kind: 'capsule', w: 13, h: 7 } },
  contempt: { arcDeg: 44, orbitS: 7, eye: { kind: 'capsule', w: 8, h: 12 }, asymmetric: true },
  neutral: { arcDeg: 26, orbitS: 9, eye: { kind: 'capsule', w: 8, h: 12 } },
};

const EYE_DX = 14;
const EYE_Y = 46;

function Eye({ shape, x, tiltSign }: { shape: EyeShape; x: number; tiltSign: number }) {
  if (shape.kind === 'dot') {
    return <circle cx={x} cy={EYE_Y} r={shape.r ?? 5} fill={FEATURE} />;
  }
  if (shape.kind === 'arc') {
    // A "◠": ends pointing down, which is what reads as a smiling eye.
    const w = 9;
    return (
      <path
        d={`M ${x - w} ${EYE_Y + 3} Q ${x} ${EYE_Y - 7} ${x + w} ${EYE_Y + 3}`}
        stroke={FEATURE}
        strokeWidth={5}
        strokeLinecap="round"
        fill="none"
      />
    );
  }
  const w = shape.w ?? 8;
  const h = shape.h ?? 12;
  const tilt = (shape.tilt ?? 0) * tiltSign;
  return (
    <rect
      x={x - w / 2}
      y={EYE_Y - h / 2}
      width={w}
      height={h}
      rx={Math.min(w, h) / 2}
      fill={FEATURE}
      transform={tilt ? `rotate(${tilt} ${x} ${EYE_Y})` : undefined}
    />
  );
}

export interface AffectFaceProps {
  /** Null renders the resting face, so the badge never disappears. */
  label: AffectLabel | null;
  size?: number;
  className?: string;
  title?: string;
}

export function AffectFace({ label, size = 56, className, title }: AffectFaceProps) {
  const spec = FACES[label ?? 'neutral'];
  const dash = (spec.arcDeg / 360) * CIRCUMFERENCE;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={cn('block', className)}
      role="img"
      aria-label={title}
    >
      <circle cx={CX} cy={CY} r={R + RING_WIDTH / 2} fill="var(--text-on-media)" opacity={0.94} />

      <circle cx={CX} cy={CY} r={R} fill="none" stroke={RING} strokeWidth={RING_WIDTH} />

      {/* The travelling segment. Drawn as a dashed circle and spun with CSS, so
          the arc length is one number and the orbit costs no JavaScript. */}
      <circle
        className="af-orbit"
        cx={CX}
        cy={CY}
        r={R}
        fill="none"
        stroke={FEATURE}
        strokeWidth={RING_WIDTH}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${CIRCUMFERENCE - dash}`}
        style={{ animationDuration: `${spec.orbitS}s` }}
      />

      {/* Keyed on the label so a change remounts the group and replays the pop. */}
      <g key={label ?? 'neutral'} className="af-eyes">
        <Eye shape={spec.eye} x={CX - EYE_DX} tiltSign={1} />
        <Eye shape={spec.eye} x={CX + EYE_DX} tiltSign={spec.asymmetric ? -1 : 1} />
      </g>

      {spec.dot
        ? (() => {
            const [dx, dy] = point(spec.dot.deg);
            return <circle cx={dx} cy={dy} r={spec.dot.r ?? 5} fill={FEATURE} />;
          })()
        : null}
    </svg>
  );
}
