'use client';

/**
 * Voice capture pipeline — spec §50 Audio Architecture, §22.3 turn-taking / barge-in.
 *
 *   MediaDevices → getUserMedia → AudioContext
 *        ├── AnalyserNode      → waveform (rendered on canvas, off the React tree)
 *        └── AudioWorkletNode  → RMS meter + noise floor + VAD (audio thread)
 *
 * The worklet processor is compiled from a string into a Blob URL because this
 * feature does not own `apps/web/public` — no extra static asset is required.
 *
 * Barge-in (§22.3): while the persona is speaking, sustained voice energy on the
 * input cancels TTS immediately and hands the floor back to the trainee.
 *
 * Echo handling: we rely on the browser's `echoCancellation` constraint plus a
 * hard rule that the TTS element is the ONLY audio sink — the worklet graph ends
 * in a zero-gain node, so the microphone is never routed back to the speakers.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AudioDeviceOption, MicPermission } from '../lib/types';
import { useSessionActions, useSessionStore } from '../store/session-store';
import {
  cancelSpeech,
  pickVoice,
  recognitionCapability,
  speak,
  synthesisCapability,
  type RecognitionCapability,
  type SpeechGender,
} from '../lib/system-speech';

const PROCESSOR_NAME = 'ai-coach-level-vad';

/**
 * AudioWorklet processor source. Runs on the audio thread (§95 — no AI or DSP on
 * the main thread). Posts a level/noise/VAD frame roughly every 16 ms.
 */
const PROCESSOR_SOURCE = `
class LevelVadProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const opts = (options && options.processorOptions) || {};
    this.minThreshold = typeof opts.minThreshold === 'number' ? opts.minThreshold : 0.012;
    this.noiseMultiplier = typeof opts.noiseMultiplier === 'number' ? opts.noiseMultiplier : 2.6;
    this.hangoverFrames = typeof opts.hangoverFrames === 'number' ? opts.hangoverFrames : 12;
    this.noise = 0.004;
    this.hangover = 0;
    this.frame = 0;
    this.lastActive = false;
    this.muted = false;
    this.port.onmessage = (event) => {
      const data = event.data || {};
      if (data.type === 'mute') this.muted = !!data.value;
      if (data.type === 'reset') { this.noise = 0.004; this.hangover = 0; this.lastActive = false; }
    };
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    if (!channel) return true;

    let sum = 0;
    let peak = 0;
    for (let i = 0; i < channel.length; i += 1) {
      const sample = channel[i];
      sum += sample * sample;
      const abs = sample < 0 ? -sample : sample;
      if (abs > peak) peak = abs;
    }
    const rms = Math.sqrt(sum / channel.length);

    // Asymmetric noise-floor tracker: falls fast, rises slowly, so a cough does
    // not permanently raise the gate.
    if (rms < this.noise) this.noise = this.noise * 0.94 + rms * 0.06;
    else this.noise = this.noise * 0.9995 + rms * 0.0005;

    const threshold = Math.max(this.minThreshold, this.noise * this.noiseMultiplier);
    const voiced = !this.muted && rms > threshold;

    if (voiced) this.hangover = this.hangoverFrames;
    else if (this.hangover > 0) this.hangover -= 1;
    const active = this.hangover > 0;

    if (active !== this.lastActive) {
      this.lastActive = active;
      this.port.postMessage({ type: 'vad', active: active, rms: rms });
    }

    this.frame += 1;
    if (this.frame % 6 === 0) {
      this.port.postMessage({ type: 'level', rms: rms, peak: peak, noise: this.noise, active: active });
    }
    return true;
  }
}
registerProcessor('${PROCESSOR_NAME}', LevelVadProcessor);
`;

export interface UseVoiceSessionOptions {
  /** Voice is only wired up on the voice page / when the trainee enables it. */
  enabled: boolean;
  /** True while the persona's TTS is playing — the barge-in trigger window. */
  personaSpeaking: boolean;
  /** Push-to-talk mode: the mic gate follows the key/button instead of VAD. */
  pushToTalk?: boolean;
  onBargeIn?: () => void;
  onSpeechStart?: () => void;
  onSpeechEnd?: (durationMs: number) => void;
  /** Fired after this much continuous silence while the floor is the trainee's. */
  onSilenceTimeout?: () => void;
  silenceTimeoutMs?: number;
  /**
   * End-of-utterance silence. Speech is only "finished" after this much
   * continuous quiet; a pause shorter than this is the same sentence. The VAD
   * itself reacts in tens of milliseconds, which is right for the level meter
   * and barge-in but wrong for segmentation — at that granularity every
   * breath became its own message.
   */
  utteranceEndSilenceMs?: number;
  /**
   * One finished utterance (push-to-talk released, or VAD saw the trainee stop).
   * The blob is what the microphone heard; the page decides what to do with it
   * — in practice, send it to the API for transcription. Never leaves the hook
   * in any other direction.
   */
  onUtterance?: (blob: Blob, mime: string, durationMs: number) => void;
  /** Persona identity, so the OS fallback picks a matching system voice. */
  personaGender?: SpeechGender | null;
  personaAge?: number | null;
  locale?: string;
}

export interface VoiceSessionApi {
  micLive: boolean;
  starting: boolean;
  permission: MicPermission;
  error: string | null;
  /** Live analyser for the canvas waveform. Null until the mic starts. */
  analyser: AnalyserNode | null;
  level: number;
  noiseFloor: number;
  vadActive: boolean;
  muted: boolean;
  pushToTalkHeld: boolean;
  devices: AudioDeviceOption[];
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  start: () => Promise<void>;
  stop: () => void;
  toggleMute: () => void;
  setMuted: (value: boolean) => void;
  setPushToTalkHeld: (pressed: boolean) => void;
  selectInputDevice: (deviceId: string) => Promise<void>;
  selectOutputDevice: (deviceId: string) => Promise<void>;
  refreshDevices: () => Promise<void>;
  /** Play a TTS clip through the selected output device. */
  playTts: (url: string) => Promise<void>;
  /**
   * Speak a persona turn. Prefers server audio (ElevenLabs); falls back to the
   * on-device system voice when there is none — which is also the no-network
   * and no-API-key case. Returns which engine actually spoke.
   */
  speakTurn: (text: string, audioUrl?: string | null) => Promise<'cloud' | 'system' | 'none'>;
  /** OS voices for this locale, once probed. Empty until the first probe. */
  systemVoices: SpeechSynthesisVoice[];
  /** Where the browser's speech *recognition* runs. Disclosed, never assumed. */
  recognition: RecognitionCapability;
  /** Stop TTS immediately (barge-in, pause, end call). */
  cancelTts: () => void;
  ttsPlaying: boolean;
}

interface Graph {
  stream: MediaStream;
  recorder: MediaRecorder | null;
  recorderChunks: Blob[];
  recorderMime: string;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  analyser: AnalyserNode;
  worklet: AudioWorkletNode | null;
  sink: GainNode;
  blobUrl: string | null;
  pollTimer: number | null;
}

/** Opus-in-WebM everywhere it exists; Safari only records MP4/AAC. */
function pickRecorderMime(): string {
  if (typeof MediaRecorder === 'undefined') return '';
  for (const mime of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

function resolveAudioContext(): typeof AudioContext | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & { webkitAudioContext?: typeof AudioContext };
  return window.AudioContext ?? w.webkitAudioContext ?? null;
}

export function useVoiceSession(options: UseVoiceSessionOptions): VoiceSessionApi {
  const {
    enabled,
    personaSpeaking,
    pushToTalk = false,
    silenceTimeoutMs = 8000,
    utteranceEndSilenceMs = 900,
    personaGender = null,
    personaAge = null,
    locale = 'zh-TW',
  } = options;

  const actions = useSessionActions();
  const storedMuted = useSessionStore((s) => s.voice.muted);
  const storedInputDevice = useSessionStore((s) => s.voice.inputDeviceId);
  const storedOutputDevice = useSessionStore((s) => s.voice.outputDeviceId);

  const [micLive, setMicLive] = useState(false);
  const [starting, setStarting] = useState(false);
  const [permission, setPermission] = useState<MicPermission>('unknown');
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<AudioDeviceOption[]>([]);
  const [level, setLevel] = useState(0);
  const [noiseFloor, setNoiseFloor] = useState(0);
  const [vadActive, setVadActive] = useState(false);
  const [pushToTalkHeld, setPushToTalkHeldState] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  // Read by the VAD path: while the customer is audibly speaking, the mic is
  // hearing the speakers, and whatever it hears must not become a transcript.
  const ttsPlayingRef = useRef(false);
  ttsPlayingRef.current = ttsPlaying;
  const [systemVoices, setSystemVoices] = useState<SpeechSynthesisVoice[]>([]);
  // Probed once and cached: the engine is a property of the machine, not the turn.
  const [recognition] = useState<RecognitionCapability>(() => recognitionCapability());
  const speechEngine = useSessionStore((s) => s.voice.speechEngine);
  const speechEngineRef = useRef(speechEngine);
  speechEngineRef.current = speechEngine;
  const systemVoicesRef = useRef<SpeechSynthesisVoice[]>([]);
  const personaGenderRef = useRef<SpeechGender | null>(personaGender);
  personaGenderRef.current = personaGender;
  const personaAgeRef = useRef<number | null>(personaAge);
  personaAgeRef.current = personaAge;
  const localeRef = useRef(locale);
  localeRef.current = locale;
  const playTtsRef = useRef<(url: string) => Promise<void>>(async () => undefined);
  // `finalizeUtterance` is declared after `speakTurn` (it needs the recorder
  // helpers); a ref avoids both a TDZ error in the deps array and a stale closure.
  const finalizeRef = useRef<() => void>(() => undefined);
  const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);

  const graphRef = useRef<Graph | null>(null);
  const callbacks = useRef(options);
  callbacks.current = options;

  const levelRef = useRef(0);
  const noiseRef = useRef(0);
  const speakingSinceRef = useRef<number | null>(null);
  // Pending end-of-utterance timer; non-null means "quiet, but maybe just a pause".
  const endpointTimerRef = useRef<number | null>(null);
  const endSilenceRef = useRef(utteranceEndSilenceMs);
  endSilenceRef.current = utteranceEndSilenceMs;
  const lastVoiceAtRef = useRef<number>(0);
  const silenceTimerRef = useRef<number | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const pushToTalkRef = useRef(pushToTalk);
  pushToTalkRef.current = pushToTalk;
  const personaSpeakingRef = useRef(personaSpeaking);
  personaSpeakingRef.current = personaSpeaking;
  const heldRef = useRef(false);
  const mutedRef = useRef(storedMuted);
  mutedRef.current = storedMuted;

  // ---- TTS -----------------------------------------------------------------

  const cancelTts = useCallback(() => {
    // Barge-in has to silence whichever engine is talking, not just the one we
    // would have chosen — the other may still be mid-sentence.
    cancelSpeech();
    const el = audioElRef.current;
    if (!el) return;
    try {
      el.pause();
      el.currentTime = 0;
    } catch {
      // A detached element can throw; nothing to recover.
    }
    setTtsPlaying(false);
  }, []);

  /**
   * Speak one persona turn. `auto` prefers the server's ElevenLabs audio and
   * falls back to the on-device voice when the server sent none — which is the
   * same path taken with no API key and with no network. `cloud` deliberately
   * stays silent rather than downgrading, so a demo cannot quietly lose the
   * voice it was set up to show.
   */
  const speakTurn = useCallback(
    async (text: string, audioUrl?: string | null): Promise<'cloud' | 'system' | 'none'> => {
      const engine = speechEngineRef.current;
      if (mutedRef.current) return 'none';
      // The floor changes hands: anything the trainee was saying is closed and
      // sent before the customer starts, so the two never share a recording.
      finalizeRef.current();

      if (audioUrl && engine !== 'system') {
        try {
          await playTtsRef.current(audioUrl);
          return 'cloud';
        } catch {
          // Fall through: a broken clip is exactly when the fallback earns itself.
        }
      }
      if (engine === 'cloud') return 'none';

      const voice = pickVoice(systemVoicesRef.current, personaGenderRef.current, personaAgeRef.current);
      const started = speak(text, {
        voice,
        lang: localeRef.current,
        onEnd: () => setTtsPlaying(false),
        onError: () => setTtsPlaying(false),
      });
      if (started) setTtsPlaying(true);
      return started ? 'system' : 'none';
    },
    [],
  );

  // Probe the OS voices once the mic side is enabled; the list is per-machine.
  // Deliberately NOT gated on `enabled`. That flag means "the microphone is
  // wanted", and speaking has nothing to do with listening: gating the probe on
  // it left the engine picker showing "no system voices" — and the system
  // option disabled — on any page where the trainee had not started their mic.
  useEffect(() => {
    let cancelled = false;
    void synthesisCapability(locale).then((cap) => {
      if (cancelled) return;
      setSystemVoices(cap.voices);
      systemVoicesRef.current = cap.voices;
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  const playTts = useCallback(
    async (url: string) => {
      if (!url) return;
      try {
        let el = audioElRef.current;
        if (!el) {
          el = new Audio();
          el.preload = 'auto';
          audioElRef.current = el;
        }
        el.onended = () => setTtsPlaying(false);
        el.onerror = () => setTtsPlaying(false);
        el.src = url;
        const sinkId = storedOutputDevice;
        const withSink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
        if (sinkId && typeof withSink.setSinkId === 'function') {
          try {
            await withSink.setSinkId(sinkId);
          } catch {
            // Output routing is a nice-to-have; never block playback on it.
          }
        }
        await el.play();
        setTtsPlaying(true);
      } catch {
        // Autoplay policies can reject; captions still carry the content (§50).
        setTtsPlaying(false);
      }
    },
    [storedOutputDevice],
  );

  playTtsRef.current = playTts;

  // ---- Devices -------------------------------------------------------------

  const refreshDevices = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      setDevices([]);
      return;
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const audio = all
        .filter((d) => d.kind === 'audioinput' || d.kind === 'audiooutput')
        .map((d, index) => ({
          deviceId: d.deviceId,
          kind: d.kind === 'audiooutput' ? ('audiooutput' as const) : ('audioinput' as const),
          // Labels are empty until permission is granted — keep it human anyway.
          label: d.label || `${d.kind === 'audiooutput' ? 'Output' : 'Microphone'} ${index + 1}`,
        }));
      setDevices(audio);
    } catch {
      setDevices([]);
    }
  }, []);

  // ---- Teardown ------------------------------------------------------------

  const teardown = useCallback(() => {
    const graph = graphRef.current;
    graphRef.current = null;
    if (silenceTimerRef.current) {
      window.clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (!graph) {
      setMicLive(false);
      setAnalyser(null);
      return;
    }
    if (endpointTimerRef.current !== null) {
      window.clearTimeout(endpointTimerRef.current);
      endpointTimerRef.current = null;
    }
    speakingSinceRef.current = null;
    try {
      if (graph.recorder && graph.recorder.state !== 'inactive') graph.recorder.stop();
      graph.recorder = null;
      if (graph.pollTimer) window.clearInterval(graph.pollTimer);
      graph.worklet?.port.close();
      graph.worklet?.disconnect();
      graph.analyser.disconnect();
      graph.source.disconnect();
      graph.sink.disconnect();
      for (const track of graph.stream.getTracks()) track.stop();
      if (graph.blobUrl) URL.revokeObjectURL(graph.blobUrl);
      void graph.context.close();
    } catch {
      // Teardown is best-effort — a failure here must not surface to the user.
    }
    setMicLive(false);
    setAnalyser(null);
    setVadActive(false);
    setLevel(0);
    actions.setVoice({ vadActive: false });
  }, [actions]);

  // ---- Utterance capture -----------------------------------------------------
  // Recording follows the *floor*, not the audio graph: it starts when the
  // trainee takes the floor (key down, or VAD onset) and stops when they give it
  // up. Between those two points the mic is already open for VAD, so this adds
  // no permission prompt and no second capture.
  const startRecording = useCallback(() => {
    const graph = graphRef.current;
    if (!graph || graph.recorder || typeof MediaRecorder === 'undefined') return;
    try {
      const recorder = graph.recorderMime
        ? new MediaRecorder(graph.stream, { mimeType: graph.recorderMime })
        : new MediaRecorder(graph.stream);
      graph.recorderChunks = [];
      recorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) graph.recorderChunks.push(event.data);
      };
      recorder.start(250);
      graph.recorder = recorder;
    } catch {
      graph.recorder = null;
    }
  }, []);

  const stopRecording = useCallback((durationMs: number) => {
    const graph = graphRef.current;
    const recorder = graph?.recorder;
    if (!graph || !recorder) return;
    graph.recorder = null;
    recorder.onstop = () => {
      const mime = recorder.mimeType || graph.recorderMime || 'audio/webm';
      const blob = new Blob(graph.recorderChunks, { type: mime });
      graph.recorderChunks = [];
      // Under ~300ms is a key tap, not a sentence; sending it wastes a round trip
      // and produces an empty transcript the UI then has to explain.
      if (blob.size > 0 && durationMs >= 300) {
        callbacks.current.onUtterance?.(blob, mime, durationMs);
      }
    };
    try {
      recorder.stop();
    } catch {
      // Already inactive; nothing to flush.
    }
  }, []);

  /** Close the current utterance now: stop capture, hand the blob over. */
  const finalizeUtterance = useCallback(() => {
    if (endpointTimerRef.current !== null) {
      window.clearTimeout(endpointTimerRef.current);
      endpointTimerRef.current = null;
    }
    if (speakingSinceRef.current === null) return;
    const duration = Date.now() - speakingSinceRef.current;
    speakingSinceRef.current = null;
    stopRecording(duration);
    callbacks.current.onSpeechEnd?.(duration);
  }, [stopRecording]);
  finalizeRef.current = finalizeUtterance;

  // ---- VAD / barge-in ------------------------------------------------------

  const handleVad = useCallback(
    (active: boolean) => {
      // In push-to-talk mode the physical control is the gate, not energy (§22.2).
      const gated = pushToTalkRef.current ? heldRef.current : true;
      const effective = active && gated && !mutedRef.current;

      setVadActive((prev) => (prev === effective ? prev : effective));

      if (effective) {
        // STT is off while TTS is audible. The microphone is hearing the
        // speakers; recording that would transcribe the customer's own line
        // back as the trainee's. Voice energy here still counts as barge-in —
        // it stops the TTS at once — and capture begins on the next VAD tick,
        // when `ttsPlayingRef` has already gone false, so only the first few
        // tens of milliseconds of the interruption are lost.
        if (ttsPlayingRef.current) {
          if (personaSpeakingRef.current || ttsPlayingRef.current) {
            cancelTts();
            actions.registerBargeIn();
            callbacks.current.onBargeIn?.();
          }
          return;
        }
        // Voice resumed inside the pause window: same utterance, keep recording.
        if (endpointTimerRef.current !== null) {
          window.clearTimeout(endpointTimerRef.current);
          endpointTimerRef.current = null;
        }
        if (speakingSinceRef.current === null) {
          speakingSinceRef.current = Date.now();
          startRecording();
          callbacks.current.onSpeechStart?.();
          // Barge-in on text-only persona turns (no audio playing).
          if (personaSpeakingRef.current) {
            actions.registerBargeIn();
            callbacks.current.onBargeIn?.();
          }
        }
      } else if (speakingSinceRef.current !== null && endpointTimerRef.current === null) {
        // Quiet. Do not end the utterance yet — wait out a natural pause.
        endpointTimerRef.current = window.setTimeout(() => {
          endpointTimerRef.current = null;
          finalizeUtterance();
        }, endSilenceRef.current);
      }
    },
    [actions, cancelTts, finalizeUtterance, startRecording],
  );

  // ---- Start ---------------------------------------------------------------

  const start = useCallback(async () => {
    if (graphRef.current || starting) return;
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPermission('unsupported');
      setError('This browser cannot capture audio. Use the text composer instead.');
      actions.setVoice({ permission: 'unsupported', lastError: 'getUserMedia unavailable' });
      return;
    }
    const AudioContextCtor = resolveAudioContext();
    if (!AudioContextCtor) {
      setPermission('unsupported');
      setError('Web Audio is unavailable in this browser.');
      return;
    }

    setStarting(true);
    setError(null);

    try {
      const audioConstraints: MediaTrackConstraints = {
        // Echo cancellation is the first line of defence against the TTS output
        // re-entering the mic; the graph terminator below is the second (§50).
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      };
      if (storedInputDevice) audioConstraints.deviceId = { exact: storedInputDevice };

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraints,
        video: false,
      });

      setPermission('granted');
      actions.setVoice({ permission: 'granted', lastError: null });

      const context = new AudioContextCtor();
      if (context.state === 'suspended') {
        // Required by autoplay policy when start() is not in a gesture stack.
        await context.resume().catch(() => undefined);
      }

      const source = context.createMediaStreamSource(stream);
      const analyserNode = context.createAnalyser();
      analyserNode.fftSize = 1024;
      analyserNode.smoothingTimeConstant = 0.75;
      source.connect(analyserNode);

      // Zero-gain terminator: keeps the graph pulled without ever reaching the
      // speakers (that would be an echo loop).
      const sink = context.createGain();
      sink.gain.value = 0;
      sink.connect(context.destination);

      let worklet: AudioWorkletNode | null = null;
      let blobUrl: string | null = null;
      let pollTimer: number | null = null;

      const onLevel = (rms: number, noise: number, active: boolean): void => {
        levelRef.current = Math.min(1, rms * 6);
        noiseRef.current = Math.min(1, noise * 6);
        if (active) lastVoiceAtRef.current = Date.now();
        handleVad(active);
      };

      if (context.audioWorklet) {
        try {
          const blob = new Blob([PROCESSOR_SOURCE], { type: 'application/javascript' });
          blobUrl = URL.createObjectURL(blob);
          await context.audioWorklet.addModule(blobUrl);
          worklet = new AudioWorkletNode(context, PROCESSOR_NAME, {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            processorOptions: { minThreshold: 0.012, noiseMultiplier: 2.6, hangoverFrames: 12 },
          });
          worklet.port.onmessage = (event: MessageEvent) => {
            const data = event.data as { type?: string; rms?: number; noise?: number; active?: boolean };
            if (!data || typeof data !== 'object') return;
            if (data.type === 'level') {
              onLevel(data.rms ?? 0, data.noise ?? 0, data.active ?? false);
            } else if (data.type === 'vad') {
              if (data.active) lastVoiceAtRef.current = Date.now();
              handleVad(!!data.active);
            }
          };
          source.connect(worklet);
          worklet.connect(sink);
        } catch {
          // AudioWorklet blocked (strict CSP, old browser) — fall back below.
          worklet = null;
          if (blobUrl) {
            URL.revokeObjectURL(blobUrl);
            blobUrl = null;
          }
        }
      }

      if (!worklet) {
        // Analyser-based fallback: same signals, coarser cadence, main thread.
        const buffer = new Float32Array(analyserNode.fftSize);
        let hangover = 0;
        let noise = 0.004;
        pollTimer = window.setInterval(() => {
          analyserNode.getFloatTimeDomainData(buffer);
          let sum = 0;
          for (let i = 0; i < buffer.length; i += 1) {
            const v = buffer[i] ?? 0;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / buffer.length);
          noise = rms < noise ? noise * 0.94 + rms * 0.06 : noise * 0.9995 + rms * 0.0005;
          const voiced = !mutedRef.current && rms > Math.max(0.012, noise * 2.6);
          if (voiced) hangover = 8;
          else if (hangover > 0) hangover -= 1;
          onLevel(rms, noise, hangover > 0);
        }, 40);
      }

      graphRef.current = {
        stream,
        recorder: null,
        recorderChunks: [],
        recorderMime: pickRecorderMime(),
        context,
        source,
        analyser: analyserNode,
        worklet,
        sink,
        blobUrl,
        pollTimer,
      };

      // Honour a mute that was toggled before the mic came up.
      for (const track of stream.getAudioTracks()) track.enabled = !mutedRef.current;

      setAnalyser(analyserNode);
      setMicLive(true);
      lastVoiceAtRef.current = Date.now();
      void refreshDevices();

      // Silence watchdog (§22.3 turn timeout).
      silenceTimerRef.current = window.setInterval(() => {
        if (personaSpeakingRef.current || mutedRef.current) return;
        const since = Date.now() - lastVoiceAtRef.current;
        if (since >= silenceTimeoutMs) {
          lastVoiceAtRef.current = Date.now();
          callbacks.current.onSilenceTimeout?.();
        }
      }, 1000);
    } catch (err) {
      const denied =
        err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError');
      setPermission(denied ? 'denied' : 'prompt');
      const message = denied
        ? 'Microphone permission is required for a voice session.'
        : err instanceof Error
          ? err.message
          : 'Could not open the microphone.';
      setError(message);
      actions.setVoice({ permission: denied ? 'denied' : 'prompt', lastError: message });
    } finally {
      setStarting(false);
    }
  }, [actions, handleVad, refreshDevices, silenceTimeoutMs, starting, storedInputDevice]);

  /**
   * Publish the level / noise floor as *local* state at 5 Hz, and only when the
   * value actually moved. The canvas waveform reads the AnalyserNode directly,
   * so nothing here needs a 60 fps state update — and nothing is written to the
   * shared store, which would re-render the transcript several times a second.
   */
  useEffect(() => {
    if (!micLive) return undefined;
    let lastLevel = -1;
    let lastNoise = -1;
    const id = window.setInterval(() => {
      const level = levelRef.current;
      const noise = noiseRef.current;
      if (Math.abs(level - lastLevel) > 0.03) {
        lastLevel = level;
        setLevel(level);
      }
      if (Math.abs(noise - lastNoise) > 0.03) {
        lastNoise = noise;
        setNoiseFloor(noise);
      }
    }, 200);
    return () => window.clearInterval(id);
  }, [micLive]);

  useEffect(() => {
    actions.setVoice({ vadActive });
  }, [actions, vadActive]);

  // Probe the permission state up-front so the UI can explain itself before the
  // trainee clicks anything (§94 — a modal only for a truly blocking problem).
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined') return;
    const perms = navigator.permissions as
      | { query?: (d: { name: string }) => Promise<{ state: string }> }
      | undefined;
    if (!perms?.query) return;
    let cancelled = false;
    perms
      .query({ name: 'microphone' })
      .then((status) => {
        if (cancelled) return;
        const state = status.state === 'granted' ? 'granted' : status.state === 'denied' ? 'denied' : 'prompt';
        setPermission(state);
        actions.setVoice({ permission: state });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [actions, enabled]);

  // Device hot-plug.
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.mediaDevices) return undefined;
    const handler = () => void refreshDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', handler);
    void refreshDevices();
    return () => navigator.mediaDevices.removeEventListener?.('devicechange', handler);
  }, [enabled, refreshDevices]);

  // Stop the mic when voice is switched off or the page unmounts.
  useEffect(() => {
    if (enabled) return undefined;
    teardown();
    cancelTts();
    return undefined;
  }, [cancelTts, enabled, teardown]);

  useEffect(
    () => () => {
      teardown();
      cancelTts();
    },
    [cancelTts, teardown],
  );

  // ---- Controls ------------------------------------------------------------

  const setMuted = useCallback(
    (value: boolean) => {
      mutedRef.current = value;
      actions.setVoice({ muted: value });
      const graph = graphRef.current;
      if (graph) {
        for (const track of graph.stream.getAudioTracks()) track.enabled = !value;
        graph.worklet?.port.postMessage({ type: 'mute', value });
      }
      if (value) {
        finalizeUtterance();
        handleVad(false);
      }
    },
    [actions, finalizeUtterance, handleVad],
  );

  const toggleMute = useCallback(() => setMuted(!mutedRef.current), [setMuted]);

  const setPushToTalkHeld = useCallback(
    (pressed: boolean) => {
      heldRef.current = pressed;
      setPushToTalkHeldState(pressed);
      actions.setVoice({ pushToTalkHeld: pressed });
      if (pressed) {
        // Start on key-down so the first syllable is not lost waiting for VAD.
        if (speakingSinceRef.current === null) speakingSinceRef.current = Date.now();
        startRecording();
      } else {
        // Releasing the key *is* the end of the sentence; no pause window here.
        finalizeUtterance();
        handleVad(false);
      }
    },
    [actions, finalizeUtterance, handleVad, startRecording],
  );

  const selectInputDevice = useCallback(
    async (deviceId: string) => {
      actions.setVoice({ inputDeviceId: deviceId });
      if (graphRef.current) {
        // Re-open the capture chain on the new device.
        teardown();
        await new Promise((resolve) => window.setTimeout(resolve, 60));
        await start();
      }
    },
    [actions, start, teardown],
  );

  const selectOutputDevice = useCallback(
    async (deviceId: string) => {
      actions.setVoice({ outputDeviceId: deviceId });
      const el = audioElRef.current as
        | (HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> })
        | null;
      if (el && typeof el.setSinkId === 'function') {
        try {
          await el.setSinkId(deviceId);
        } catch {
          // Firefox / Safari have no setSinkId — the OS default is used.
        }
      }
    },
    [actions],
  );

  const stop = useCallback(() => {
    teardown();
    cancelTts();
  }, [cancelTts, teardown]);

  return useMemo<VoiceSessionApi>(
    () => ({
      micLive,
      starting,
      permission,
      error,
      analyser,
      level,
      noiseFloor,
      vadActive,
      muted: storedMuted,
      pushToTalkHeld,
      devices,
      inputDeviceId: storedInputDevice,
      outputDeviceId: storedOutputDevice,
      start,
      stop,
      toggleMute,
      setMuted,
      setPushToTalkHeld,
      selectInputDevice,
      selectOutputDevice,
      refreshDevices,
      playTts,
      speakTurn,
      systemVoices,
      recognition,
      cancelTts,
      ttsPlaying,
    }),
    [
      analyser,
      cancelTts,
      devices,
      error,
      level,
      micLive,
      noiseFloor,
      permission,
      playTts,
      pushToTalkHeld,
      recognition,
      refreshDevices,
      selectInputDevice,
      selectOutputDevice,
      setMuted,
      setPushToTalkHeld,
      start,
      starting,
      stop,
      storedInputDevice,
      storedMuted,
      speakTurn,
      storedOutputDevice,
      systemVoices,
      toggleMute,
      ttsPlaying,
      vadActive,
    ],
  );
}
