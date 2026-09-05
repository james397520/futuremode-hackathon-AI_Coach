import { describe, expect, it } from 'vitest';

import { EXPRESSION_PRESETS } from '../lib/expression';
import {
  ARKIT_EXPRESSION_PRESETS,
  VRM_EXPRESSION_NAMES,
  arkitToVrm,
  composeArkit,
  expressionToArkit,
  expressionToVrm,
} from './expression-to-vrm';
import { IdleAnimator } from './idle';
import { ProceduralLipsync } from './lipsync';

describe('expression → ARKit → VRM', () => {
  it('has a preset for every expression name', () => {
    for (const name of Object.keys(EXPRESSION_PRESETS) as Array<keyof typeof EXPRESSION_PRESETS>) {
      expect(ARKIT_EXPRESSION_PRESETS[name]).toBeDefined();
    }
  });

  it('neutral maps to an empty face, all weights in [0,1]', () => {
    const weights = expressionToVrm(EXPRESSION_PRESETS.neutral);
    for (const name of VRM_EXPRESSION_NAMES) {
      expect(weights[name]).toBeGreaterThanOrEqual(0);
      expect(weights[name]).toBeLessThanOrEqual(1);
    }
    expect(weights.happy).toBe(0);
    expect(weights.angry).toBe(0);
  });

  it('scales with intensity', () => {
    const soft = expressionToArkit({ ...EXPRESSION_PRESETS.skeptical, intensity: 0.2 });
    const hard = expressionToArkit({ ...EXPRESSION_PRESETS.skeptical, intensity: 0.7 });
    expect(hard.browDownLeft ?? 0).toBeGreaterThan(soft.browDownLeft ?? 0);
    expect(expressionToArkit({ ...EXPRESSION_PRESETS.ready, intensity: 0 })).toEqual({});
  });

  it('routes the right emotions to the right VRM presets', () => {
    expect(expressionToVrm(EXPRESSION_PRESETS.ready).happy).toBeGreaterThan(0.2);
    expect(expressionToVrm(EXPRESSION_PRESETS.frustrated).angry).toBeGreaterThan(0.2);
    expect(expressionToVrm(EXPRESSION_PRESETS.concerned).sad).toBeGreaterThan(0.2);
    expect(expressionToVrm(EXPRESSION_PRESETS.skeptical).angry).toBeGreaterThan(0.1);
  });

  it('merges blink with max', () => {
    expect(arkitToVrm({ eyeBlinkLeft: 0.3 }, 0.9).blinkLeft).toBeCloseTo(0.9);
    expect(arkitToVrm({ eyeBlinkLeft: 0.95 }, 0.2).blinkLeft).toBeCloseTo(0.95);
  });

  it('keeps 35% of the emotion mouth while speaking', () => {
    const emotion = { mouthSmileLeft: 1, browInnerUp: 1 } as const;
    const speaking = composeArkit(emotion, { jawOpen: 0.5 }, true);
    expect(speaking.mouthSmileLeft).toBeCloseTo(0.35);
    expect(speaking.browInnerUp).toBeCloseTo(1);
    expect(speaking.jawOpen).toBeCloseTo(0.5);
    const silent = composeArkit(emotion, null, false);
    expect(silent.mouthSmileLeft).toBeCloseTo(1);
  });
});

describe('ProceduralLipsync', () => {
  it('never fully closes while speaking and closes after', () => {
    const lips = new ProceduralLipsync(() => 0.5);
    let minOpen = Infinity;
    for (let i = 0; i < 120; i++) {
      const w = lips.sample(1 / 60, true);
      expect(w).not.toBeNull();
      minOpen = Math.min(minOpen, w?.jawOpen ?? 0);
    }
    expect(minOpen).toBeGreaterThanOrEqual(0.12);
    expect(lips.active()).toBe(true);

    let closed: ReturnType<typeof lips.sample> = {};
    for (let i = 0; i < 60; i++) closed = lips.sample(1 / 60, false);
    expect(closed).toBeNull();
    expect(lips.active()).toBe(false);
  });
});

describe('IdleAnimator', () => {
  it('stays inside the §70 head clamp and blinks even with reduced motion', () => {
    const idle = new IdleAnimator(() => 0.5);
    let sawBlink = false;
    for (let i = 0; i < 60 * 12; i++) {
      const pose = idle.update(1 / 60, {
        reducedMotion: true,
        expression: EXPRESSION_PRESETS.thinking,
        speaking: false,
      });
      if (pose.blink > 0.5) sawBlink = true;
      expect(Math.abs(pose.headYaw)).toBeLessThanOrEqual((10 * Math.PI) / 180 + 1e-9);
      expect(Math.abs(pose.headPitch)).toBeLessThanOrEqual((6 * Math.PI) / 180 + 1e-9);
      expect(Math.abs(pose.headRoll)).toBeLessThanOrEqual((5 * Math.PI) / 180 + 1e-9);
    }
    expect(sawBlink).toBe(true);
  });
});
