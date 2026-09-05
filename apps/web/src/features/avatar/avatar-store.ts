'use client';

/**
 * Avatar runtime client state — one small zustand store, deliberately separate
 * from the simulation's `session-store`.
 *
 * Why separate: the avatar is optional and high-frequency. Measured fps, dropped
 * frames and A/V drift change continuously, and folding them into the session
 * store would re-render the transcript on every sample. Frame *stats* are
 * therefore written at most once a second (`reportFrameStats` is called from a
 * 1Hz tick), and the frame pixels never enter React state at all — they go
 * straight to a canvas (see `use-avatar-frames.ts`).
 *
 * The status ladder is the §53 fallback ladder:
 *   unknown → checking → (unavailable | loading → ready) and `degraded` from
 *   either side when an engine drops out mid-session.
 */
import { create } from 'zustand';

import type {
  AvatarCapabilities,
  AvatarExpressionName,
  AvatarExpressionState,
  AvatarFailure,
  AvatarFrameStats,
  AvatarHealth,
  AvatarRuntimeStatus,
  PreflightCheck,
  PreflightCheckId,
  PreflightCheckState,
} from './types';
import { EXPRESSION_PRESETS } from './lib/expression';

/** §52 — the eight gates, in the order the spec lists them. */
const INITIAL_CHECKS: PreflightCheck[] = [
  { id: 'backend', label: '虛擬人後端', state: 'pending', required: false },
  { id: 'model', label: '臉部模型載入', state: 'pending', required: false },
  { id: 'avatar_cache', label: '虛擬人快取', state: 'pending', required: false },
  { id: 'expression_bank', label: '表情資料庫', state: 'pending', required: false },
  { id: 'musetalk_warmup', label: '嘴型同步暖機', state: 'pending', required: false },
  { id: 'tts', label: '語音合成（TTS）', state: 'pending', required: true },
  { id: 'webrtc', label: '影像傳輸', state: 'pending', required: false },
  { id: 'audio_device', label: '音訊裝置', state: 'pending', required: true },
];

export interface AvatarStoreState {
  status: AvatarRuntimeStatus;
  /** Raw backend id from `/capabilities` (`mac_mlx`, `rtx_cuda`, …) — admin only. */
  backend: string | null;
  health: AvatarHealth | null;
  capabilities: AvatarCapabilities | null;
  /** Runtime session id from `POST /sessions` — not the training session id. */
  runtimeSessionId: string | null;
  /** Portrait the runtime prepared for this avatar, if it exposed one (§7). */
  portraitUrl: string | null;

  transport: 'none' | 'ws-frames' | 'webrtc' | 'mock';
  /**
   * What is actually painted on the stage right now. Orthogonal to `status`:
   * the ladder says whether the *runtime* is live, this says which surface won —
   * runtime frames, the local 3D VRM, or the CSS portrait. The badge reads it so
   * it never calls a rendered 3D character "靜態頭像".
   */
  renderer: 'frames' | 'vrm' | 'portrait';
  speaking: boolean;
  buffering: boolean;

  expression: AvatarExpressionState;
  /** Set while an `avatar.expression.transition` is in flight (§45). */
  transitionTo: AvatarExpressionName | null;

  frames: AvatarFrameStats;
  /** §51 — positive means video is behind audio. */
  avDriftMs: number;

  lastError: AvatarFailure | null;
  /** §53 — which engine degraded, so the badge can say something true. */
  degradedComponent: string | null;

  preflight: PreflightCheck[];
}

export interface AvatarStoreActions {
  setStatus: (status: AvatarRuntimeStatus) => void;
  setHealth: (health: AvatarHealth) => void;
  setCapabilities: (capabilities: AvatarCapabilities) => void;
  setRuntimeSession: (sessionId: string | null, portraitUrl?: string) => void;
  setTransport: (transport: AvatarStoreState['transport']) => void;
  setRenderer: (renderer: AvatarStoreState['renderer']) => void;
  setSpeaking: (speaking: boolean) => void;
  setBuffering: (buffering: boolean) => void;
  setExpression: (expression: AvatarExpressionState) => void;
  beginTransition: (to: AvatarExpressionName) => void;
  endTransition: () => void;
  reportFrameStats: (stats: AvatarFrameStats) => void;
  reportDrift: (ms: number) => void;
  fail: (error: AvatarFailure) => void;
  degrade: (component: string, reason?: string) => void;
  setCheck: (id: PreflightCheckId, state: PreflightCheckState, detail?: string) => void;
  reset: () => void;
}

const INITIAL_STATE: AvatarStoreState = {
  status: 'unknown',
  backend: null,
  health: null,
  capabilities: null,
  runtimeSessionId: null,
  portraitUrl: null,
  transport: 'none',
  renderer: 'portrait',
  speaking: false,
  buffering: false,
  expression: EXPRESSION_PRESETS.neutral,
  transitionTo: null,
  frames: { fps: 0, decodedFrames: 0, droppedFrames: 0, lastFrameAtMs: 0 },
  avDriftMs: 0,
  lastError: null,
  degradedComponent: null,
  preflight: INITIAL_CHECKS,
};

export const useAvatarStore = create<AvatarStoreState & AvatarStoreActions>((set) => ({
  ...INITIAL_STATE,

  setStatus: (status) => set({ status }),

  setHealth: (health) =>
    set((state) => ({
      health,
      backend: state.backend ?? health.platform,
    })),

  setCapabilities: (capabilities) => set({ capabilities, backend: capabilities.backend }),

  setRuntimeSession: (sessionId, portraitUrl) =>
    set((state) => ({
      runtimeSessionId: sessionId,
      portraitUrl: portraitUrl ?? state.portraitUrl,
    })),

  setTransport: (transport) => set({ transport }),

  setRenderer: (renderer) => set((state) => (state.renderer === renderer ? {} : { renderer })),

  setSpeaking: (speaking) => set({ speaking }),

  setBuffering: (buffering) => set({ buffering }),

  setExpression: (expression) =>
    set((state) =>
      state.expression.name === expression.name &&
      Math.abs(state.expression.intensity - expression.intensity) < 0.02
        ? {}
        : { expression },
    ),

  beginTransition: (to) => set({ transitionTo: to }),

  endTransition: () => set({ transitionTo: null }),

  reportFrameStats: (frames) => set({ frames }),

  reportDrift: (avDriftMs) => set({ avDriftMs }),

  fail: (error) =>
    set((state) => ({
      lastError: error,
      // A failure never climbs back up the ladder: if frames were already
      // arriving we stay `degraded`, otherwise the runtime is simply absent.
      status: state.status === 'ready' || state.status === 'degraded' ? 'degraded' : 'unavailable',
    })),

  degrade: (component, reason) =>
    set((state) => {
      const lastError: AvatarFailure | null =
        reason === undefined ? state.lastError : { code: 'MODEL_LOAD_FAILED', message: reason };
      return { status: 'degraded', degradedComponent: component, lastError };
    }),

  setCheck: (id, checkState, detail) =>
    set((state) => ({
      preflight: state.preflight.map((check) =>
        check.id === id
          ? { ...check, state: checkState, ...(detail === undefined ? {} : { detail }) }
          : check,
      ),
    })),

  reset: () => set({ ...INITIAL_STATE, preflight: INITIAL_CHECKS }),
}));

// ---------------------------------------------------------------------------
// Selectors — components subscribe to the narrowest slice they can.
// ---------------------------------------------------------------------------

export const useAvatarStatus = (): AvatarRuntimeStatus => useAvatarStore((s) => s.status);
export const useAvatarExpression = (): AvatarExpressionState => useAvatarStore((s) => s.expression);
export const useAvatarTransition = (): AvatarExpressionName | null =>
  useAvatarStore((s) => s.transitionTo);
export const useAvatarSpeaking = (): boolean => useAvatarStore((s) => s.speaking);
export const useAvatarPortrait = (): string | null => useAvatarStore((s) => s.portraitUrl);
export const useAvatarPreflight = (): PreflightCheck[] => useAvatarStore((s) => s.preflight);

/** True when the picture is live pixels rather than the §53 fallback. */
export function isLiveTransport(state: Pick<AvatarStoreState, 'status' | 'transport'>): boolean {
  return state.status === 'ready' && (state.transport === 'ws-frames' || state.transport === 'webrtc');
}
