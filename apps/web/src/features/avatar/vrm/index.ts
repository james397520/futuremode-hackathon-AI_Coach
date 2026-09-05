/**
 * 3D VRM persona — public surface.
 *
 * `VrmStage` itself is **not** re-exported here on purpose: it imports `three`,
 * and anything that pulls this barrel (the store, the badge, tests) must stay
 * free of it. The stage loads it with `next/dynamic` from
 * `./vrm-stage` directly.
 */
export {
  ARKIT_EXPRESSION_PRESETS,
  ARKIT_NAMES,
  SPEECH_MASK_WEIGHT,
  VRM_EXPRESSION_NAMES,
  arkitToVrm,
  composeArkit,
  expressionToArkit,
  expressionToVrm,
  type ArkitName,
  type ArkitWeights,
  type VrmExpressionName,
  type VrmWeights,
} from './expression-to-vrm';
export { IdleAnimator, prefersReducedMotion, type IdleOptions, type IdlePose } from './idle';
export {
  A2EPlayer,
  ProceduralLipsync,
  type A2EClip,
  type SpeechSource,
} from './lipsync';
export type { VrmStageProps, VrmStageStatus } from './vrm-stage';
