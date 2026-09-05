/**
 * Avatar feature — the live virtual human on the right-hand persona card.
 *
 * Public surface only. Everything else (`avatar-client`, the frame sink's
 * internals, the mock driver) is an implementation detail of this folder.
 */
export { AvatarStage, type AvatarStageProps } from './components/avatar-stage';
export { AvatarFallback, type AvatarFallbackProps } from './components/avatar-fallback';
export { RuntimeBadge, type RuntimeBadgeProps } from './components/runtime-badge';
export { AvatarPreflight, blockingChecks, type AvatarPreflightProps } from './components/preflight';
export { AvatarStyles } from './components/avatar-styles';

export { useAvatarSession, type AvatarSessionHandle, type UseAvatarSessionOptions } from './use-avatar-session';
export { useAvatarFrames, type AvatarFrameSink, type UseAvatarFramesOptions } from './use-avatar-frames';
export {
  useAvatarStore,
  useAvatarStatus,
  useAvatarExpression,
  useAvatarSpeaking,
  useAvatarPreflight,
  isLiveTransport,
} from './avatar-store';
export { AvatarClient, AvatarSocket, avatarClient } from './avatar-client';
export {
  EXPRESSION_LABEL,
  EXPRESSION_PRESETS,
  expressionStateFor,
  toRuntimeStatePayload,
} from './lib/expression';
export { useMockAvatarDriver, MOCK_AVATAR_DEMO_SEQUENCE } from './mock/mock-avatar-runtime';
export {
  resolvePersonaGender,
  genderFromName,
  genderFromVoiceId,
  type AvatarBodyGender,
  type GenderSource,
} from './lib/persona-gender';
export type {
  AvatarCapabilities,
  AvatarErrorCode,
  AvatarEvent,
  AvatarExpressionName,
  AvatarExpressionState,
  AvatarFrameStats,
  AvatarHealth,
  AvatarRuntimeStatus,
  PreflightCheck,
} from './types';
