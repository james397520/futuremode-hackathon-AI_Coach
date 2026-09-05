'use client';

/**
 * Webcam channel for trainee affect recognition.
 *
 * Deliberately the mirror image of `use-voice-session`: it owns the
 * `MediaStream`, the permission state and the teardown, and it exposes a
 * `videoRef` for a preview element. What it does *not* own is the model — see
 * `lib/affect.ts`. Until an `AffectAnalyzer` is registered this hook opens the
 * camera, samples frames, gets `null` back and emits nothing, which is exactly
 * the "channel open, model later" state we want.
 *
 * Two properties worth keeping if this is edited:
 *
 *  - **Frames never leave the browser.** `onReading` receives a label and a
 *    confidence, never pixels. There is no upload path here on purpose.
 *  - **Sampling is driven by a timer, not by rAF.** A hidden tab freezes rAF,
 *    which would silently stop the channel; a timer keeps a predictable low
 *    rate and the video element itself stalls when hidden, which is fine.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import {
  SAMPLE_INTERVAL_MS,
  affectAnalyzerInstalled,
  getAffectAnalyzer,
  shouldEmit,
  subscribeToAffectAnalyzer,
  type AffectReading,
} from '../lib/affect';

export type CameraPermission = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unsupported';

export interface UseCameraSessionOptions {
  /** Master switch. When false the camera is torn down and never reopened. */
  enabled: boolean;
  /** Called for readings that pass the change filter. Never receives pixels. */
  onReading?: (reading: AffectReading) => void;
  /** Preferred capture device, when the trainee has picked one. */
  deviceId?: string | null;
}

export interface CameraSessionApi {
  /** Attach to a `<video autoPlay muted playsInline />` to show the preview. */
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  live: boolean;
  starting: boolean;
  permission: CameraPermission;
  error: string | null;
  /** True once a real analyzer is registered; false = channel open, no model. */
  analyzerInstalled: boolean;
  /** The model is being fetched/compiled. The picture is already live. */
  modelLoading: boolean;
  /**
   * Most recent *analysis*, for the UI. Deliberately not "most recent thing we
   * sent": the emission filter is intentionally quiet, so binding the display to
   * it left the strip frozen while the classifier was working perfectly.
   */
  reading: AffectReading | null;
  /** True when the classifier ran but found no face in the frame. */
  noFace: boolean;
  /**
   * Last classifier failure. The analysis loop must never take the session down,
   * but swallowing the error silently made a broken model indistinguishable from
   * a still face — which is exactly how this went unnoticed.
   */
  lastError: string | null;
  start: () => Promise<void>;
  stop: () => void;
  toggle: () => void;
}

export function useCameraSession(options: UseCameraSessionOptions): CameraSessionApi {
  const { enabled, deviceId = null } = options;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const lastSentRef = useRef<AffectReading | null>(null);

  // The callback is read through a ref so changing it never restarts the camera.
  const onReadingRef = useRef(options.onReading);
  onReadingRef.current = options.onReading;

  const [live, setLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [permission, setPermission] = useState<CameraPermission>('unknown');
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<AffectReading | null>(null);
  const [noFace, setNoFace] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);

  // `useSyncExternalStore`, not `useState` + a subscribe effect: the page
  // registers the analyzer in an effect *declared before* this hook is called,
  // so that effect runs first and its notification lands before a subscribe
  // effect here could exist. A hand-rolled subscription therefore missed the
  // only notification it would ever get and the flag stayed false forever.
  const analyzerInstalled = useSyncExternalStore(
    subscribeToAffectAnalyzer,
    affectAnalyzerInstalled,
    () => false,
  );

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) track.stop();
    }
    const el = videoRef.current;
    if (el) el.srcObject = null;
    lastSentRef.current = null;
    setLive(false);
    setModelLoading(false);
    setReading(null);
    setNoFace(false);
    setLastError(null);
  }, []);

  const start = useCallback(async () => {
    if (streamRef.current || starting) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPermission('unsupported');
      setError('這個瀏覽器無法使用攝影機。');
      return;
    }

    setStarting(true);
    setError(null);
    try {
      const video: MediaTrackConstraints = {
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 15, max: 30 },
        facingMode: 'user',
      };
      if (deviceId) video.deviceId = { exact: deviceId };

      const stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
      streamRef.current = stream;
      setPermission('granted');

      const el = videoRef.current;
      if (el) {
        el.srcObject = stream;
        // Autoplay only survives with muted+playsInline, both set by the caller.
        await el.play().catch(() => undefined);
      }

      // The picture goes live *before* the model is ready. Loading the 3.6MB
      // model and warming its shaders takes seconds on a cold start, and
      // awaiting it here left the trainee looking at nothing with no feedback.
      setLive(true);

      setModelLoading(true);
      try {
        await getAffectAnalyzer().init?.();
      } catch {
        setError('無法載入表情辨識模型，鏡頭仍可正常使用。');
      } finally {
        setModelLoading(false);
      }
      // Cancelled while the model was loading.
      if (!streamRef.current) return;

      timerRef.current = window.setInterval(() => {
        // Drop the tick rather than queueing: a slow model must not build a backlog.
        if (busyRef.current) return;
        const frame = videoRef.current;
        if (!frame || frame.readyState < 2 || !streamRef.current) return;
        busyRef.current = true;
        void (async () => {
          try {
            const next = await getAffectAnalyzer().analyze(frame);
            setLastError(null);
            setNoFace(next === null);
            // The display follows every analysis...
            if (next) setReading(next);
            // ...while the socket only hears about real changes.
            if (next && shouldEmit(next, lastSentRef.current)) {
              lastSentRef.current = next;
              onReadingRef.current?.(next);
            }
          } catch (err) {
            // A model failure must never take the session down, but it must be
            // visible: the channel is otherwise indistinguishable from a still face.
            setLastError(err instanceof Error ? err.message : String(err));
          } finally {
            busyRef.current = false;
          }
        })();
      }, SAMPLE_INTERVAL_MS);
    } catch (err) {
      const name = err instanceof Error ? err.name : '';
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        setPermission('denied');
        setError('攝影機權限被拒絕，你可以在瀏覽器網址列重新允許。');
      } else if (name === 'NotFoundError' || name === 'OverconstrainedError') {
        setPermission('unsupported');
        setError('找不到可用的攝影機。');
      } else {
        setError('無法開啟攝影機。');
      }
      stop();
    } finally {
      setStarting(false);
    }
  }, [deviceId, starting, stop]);

  const toggle = useCallback(() => {
    if (streamRef.current) stop();
    else void start();
  }, [start, stop]);

  // Master switch off, or page unmount: the camera light must go out.
  useEffect(() => {
    if (!enabled) stop();
  }, [enabled, stop]);

  useEffect(() => () => stop(), [stop]);

  return useMemo(
    () => ({
      videoRef,
      live,
      starting,
      permission,
      error,
      analyzerInstalled,
      modelLoading,
      reading,
      noFace,
      lastError,
      start,
      stop,
      toggle,
    }),
    [
      analyzerInstalled,
      error,
      lastError,
      live,
      modelLoading,
      noFace,
      permission,
      reading,
      start,
      starting,
      stop,
      toggle,
    ],
  );
}
