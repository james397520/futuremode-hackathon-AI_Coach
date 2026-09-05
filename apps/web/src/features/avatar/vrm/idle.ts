/**
 * Procedural idle — blink, eye saccade, head sway — ported from the archive
 * viewer's `idleUpdate()`, plus the §9 head pose from `AvatarExpressionState`.
 *
 * Everything here is per-frame math on a small mutable object; nothing touches
 * React or three.js, so the stage can call `update()` from its rAF loop and the
 * numbers can be checked in a unit test.
 *
 * Reduced motion (`prefers-reduced-motion: reduce`): sway and saccade stop, the
 * expression's own head pose still applies (it is information — a skeptical
 * customer tilts away), and blinking stays, because a face that never blinks
 * reads as frozen video rather than as calm.
 */
import type { AvatarExpressionState } from '../types';
import { HEAD_PITCH_LIMIT, HEAD_ROLL_LIMIT, HEAD_YAW_LIMIT, clamp } from '../lib/expression';

const DEG = Math.PI / 180;

export interface IdlePose {
  /** 0–1 eyelid closure from the procedural blink. */
  blink: number;
  /** Head rotation in radians, already inside the §70 clamp. */
  headYaw: number;
  headPitch: number;
  headRoll: number;
  /** Gaze offset, roughly ±0.15 rad, for the VRM lookAt target. */
  gazeX: number;
  gazeY: number;
}

export interface IdleOptions {
  reducedMotion: boolean;
  /** Current §9 state — head_* are degrees, blink_rate 0–1, gaze_* −1..1. */
  expression: AvatarExpressionState;
  /** Speaking heads move a little more; listening heads settle. */
  speaking: boolean;
}

/** Deterministic-enough randomness hook so tests can pin it. */
export type Rng = () => number;

export class IdleAnimator {
  private blinkTimer = 1.5;
  /** −1 = not blinking; otherwise 0..1 progress through the 140ms sweep. */
  private blinkPhase = -1;

  private gazeTimer = 0;
  private gazeTargetX = 0;
  private gazeTargetY = 0;
  private gazeX = 0;
  private gazeY = 0;

  /** Smoothed expression head pose (degrees) so a state change eases in. */
  private poseYaw = 0;
  private posePitch = 0;
  private poseRoll = 0;

  private time = 0;
  private readonly pose: IdlePose = {
    blink: 0, headYaw: 0, headPitch: 0, headRoll: 0, gazeX: 0, gazeY: 0,
  };

  constructor(private readonly rng: Rng = Math.random) {}

  /** Advance by `dt` seconds. Returns the same object every call — do not keep it. */
  update(dt: number, options: IdleOptions): IdlePose {
    const { reducedMotion, expression, speaking } = options;
    this.time += dt;
    const t = this.time;

    // --- blink: an independent channel, merged with `max` downstream --------
    // `blink_rate` 0.2 ≈ one blink per ~4s, 0.3 ≈ every ~2.5s.
    const meanInterval = clamp(1.2 / Math.max(expression.blink_rate, 0.05), 1.5, 9);
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0 && this.blinkPhase < 0) {
      this.blinkPhase = 0;
      this.blinkTimer = meanInterval * (0.6 + this.rng() * 0.8);
    }
    let blink = 0;
    if (this.blinkPhase >= 0) {
      this.blinkPhase += dt / 0.14;
      blink = Math.sin(Math.min(this.blinkPhase, 1) * Math.PI);
      if (this.blinkPhase >= 1) this.blinkPhase = -1;
    }

    // --- gaze: saccade around eye contact, biased by the expression's gaze ---
    if (!reducedMotion) {
      this.gazeTimer -= dt;
      if (this.gazeTimer <= 0) {
        this.gazeTargetX = (this.rng() - 0.5) * 0.22;
        this.gazeTargetY = (this.rng() - 0.5) * 0.16;
        this.gazeTimer = 0.8 + this.rng() * 2.2;
      }
    } else {
      this.gazeTargetX = 0;
      this.gazeTargetY = 0;
    }
    const kGaze = 1 - Math.exp(-dt * 12);
    const biasX = expression.gaze_x * 0.25;
    const biasY = expression.gaze_y * 0.18;
    this.gazeX += (this.gazeTargetX + biasX - this.gazeX) * kGaze;
    this.gazeY += (this.gazeTargetY + biasY - this.gazeY) * kGaze;

    // --- head: eased expression pose + low-frequency sway ------------------
    const kPose = 1 - Math.exp(-dt * 2.4);
    this.poseYaw += (expression.head_yaw - this.poseYaw) * kPose;
    this.posePitch += (expression.head_pitch - this.posePitch) * kPose;
    this.poseRoll += (expression.head_roll - this.poseRoll) * kPose;

    // Viewer amplitudes (rad), doubled by the viewer for VRM head bones; kept
    // in degrees here so the §70 clamp applies to the *sum*.
    const amp = reducedMotion ? 0 : 0.7 + expression.motion_energy * 0.6 + (speaking ? 0.3 : 0);
    const swayYaw = amp * (Math.sin(t * 0.45) * 2.0 + Math.sin(t * 1.1) * 0.7);
    const swayPitch = amp * Math.sin(t * 0.6) * 1.15;
    const swayRoll = amp * Math.sin(t * 0.32) * 0.7;

    this.pose.blink = blink;
    this.pose.headYaw = clamp(this.poseYaw + swayYaw, -HEAD_YAW_LIMIT, HEAD_YAW_LIMIT) * DEG;
    this.pose.headPitch =
      clamp(this.posePitch + swayPitch, -HEAD_PITCH_LIMIT, HEAD_PITCH_LIMIT) * DEG;
    this.pose.headRoll = clamp(this.poseRoll + swayRoll, -HEAD_ROLL_LIMIT, HEAD_ROLL_LIMIT) * DEG;
    this.pose.gazeX = this.gazeX;
    this.pose.gazeY = this.gazeY;
    return this.pose;
  }
}

/** SSR-safe media query read; the stage re-checks on `change`. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
