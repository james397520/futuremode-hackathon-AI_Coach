'use client';

/**
 * macOS / OS-native speech, used as the fallback under ElevenLabs.
 *
 * The Web Speech API exposes exactly the voices `say -v '?'` lists — on this
 * machine 9 zh-TW voices, all `localService: true`, i.e. on-device and offline.
 * That matters twice over:
 *
 *  1. **It needs no audio transport.** ElevenLabs audio has to travel API →
 *     socket → browser; `speechSynthesis` speaks in the page that already has
 *     the text, so it works while that pipeline is still being built and it
 *     keeps working when the network does not.
 *  2. **It costs nothing and leaks nothing.** No characters billed, no text
 *     leaving the machine.
 *
 * The trade is quality: these are the system voices, not a studio model.
 *
 * ### A caveat that must not be glossed over
 *
 * `speechSynthesis` is genuinely on-device. **`SpeechRecognition` is not, in
 * every browser.** In Safari on macOS it is Apple's recogniser; in Chromium it
 * streams the microphone to Google's servers under the same `webkit` prefix and
 * the same API shape, with nothing in the API to tell you which you got. For a
 * corporate training product that is a disclosure issue, not a detail, so
 * `describeRecognition()` reports the engine honestly and the UI must show it.
 */

export type SpeechGender = 'male' | 'female' | 'other';

export interface SystemVoiceCapability {
  supported: boolean;
  /** Voices matching the requested locale. */
  voices: SpeechSynthesisVoice[];
  /** True when at least one match runs on-device. */
  onDevice: boolean;
}

export type RecognitionEngine = 'apple' | 'google' | 'unknown' | 'none';

export interface RecognitionCapability {
  supported: boolean;
  engine: RecognitionEngine;
  /** Plain-language note for the UI. Never hide where the audio goes. */
  note: string;
}

/**
 * `SpeechRecognition` has no `lib.dom` declaration in this TypeScript version.
 * Only construction is needed here, so this is a structural stand-in rather
 * than a fabricated full typing of an API we do not otherwise touch.
 */
export interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type RecognitionCtor = new () => SpeechRecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as Window & {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * `getVoices()` is empty until the engine has loaded them, and the load is
 * asynchronous with no promise — `voiceschanged` is the only signal, and it does
 * not fire at all when the list was already warm. Hence both paths plus a
 * timeout, or the first call after a cold load silently reports "no voices".
 */
export function loadVoices(timeoutMs = 2000): Promise<SpeechSynthesisVoice[]> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return Promise.resolve([]);
  }
  const existing = window.speechSynthesis.getVoices();
  if (existing.length > 0) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener('voiceschanged', finish, { once: true });
    window.setTimeout(finish, timeoutMs);
  });
}

export async function synthesisCapability(locale = 'zh-TW'): Promise<SystemVoiceCapability> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return { supported: false, voices: [], onDevice: false };
  }
  const all = await loadVoices();
  const prefix = locale.split('-')[0] ?? 'zh';
  const voices = all.filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(prefix));
  return {
    supported: voices.length > 0,
    voices,
    onDevice: voices.some((v) => v.localService),
  };
}

export function recognitionCapability(): RecognitionCapability {
  const ctor = recognitionCtor();
  if (!ctor) {
    return { supported: false, engine: 'none', note: '這個瀏覽器沒有內建語音辨識。' };
  }
  const ua = navigator.userAgent;
  // Chrome's UA also contains "Safari"; the reliable test is the absence of the
  // Chromium markers, not the presence of Safari.
  const isChromium = /Chrome|Chromium|Edg\//.test(ua);
  if (!isChromium && /Safari/.test(ua)) {
    return { supported: true, engine: 'apple', note: '使用 Apple 內建辨識，語音不離開這台電腦。' };
  }
  if (isChromium) {
    return {
      supported: true,
      engine: 'google',
      note: '這個瀏覽器的內建辨識會把語音送到 Google 伺服器處理。',
    };
  }
  return { supported: true, engine: 'unknown', note: '無法判斷辨識引擎在哪裡執行。' };
}

/**
 * Pick a system voice for a persona, mirroring the ElevenLabs table in
 * `apps/api/app/ws/voice_catalog.py`.
 *
 * The system set has something ElevenLabs does not: Grandpa / Grandma are
 * actually elderly voices, so a 70-year-old persona can sound like one here
 * rather than borrowing the middle-aged voice.
 *
 * Matching is by name because `SpeechSynthesisVoice` carries no gender or age —
 * these are Apple's fixed voice names, stable across releases.
 */
const PREFERRED: Record<string, readonly string[]> = {
  'male:senior': ['Grandpa'],
  'female:senior': ['Grandma'],
  'male:young': ['Eddy', 'Reed', 'Rocko'],
  'female:young': ['Flo', 'Sandy', 'Shelley'],
  'male:middle': ['Reed', 'Rocko', 'Eddy'],
  'female:middle': ['美佳', 'Meijia', 'Sandy', 'Shelley'],
};

export const SENIOR_MIN_AGE = 65;
export const YOUNG_MAX_AGE = 35;

export function ageBand(age: number | null | undefined): 'young' | 'middle' | 'senior' {
  if (age == null) return 'middle';
  if (age >= SENIOR_MIN_AGE) return 'senior';
  return age < YOUNG_MAX_AGE ? 'young' : 'middle';
}

/**
 * macOS ships three tiers of the same voice and only the lowest is installed
 * by default. `SpeechSynthesisVoice` has no quality field; the tier shows up in
 * the name — "美佳 (進階)", "Meijia (Enhanced)", "(高級)" / "(Premium)". The
 * eight "Eddy / Flo / Reed …" voices are the old Eloquence engine and are the
 * reason the fallback sounded nothing like a phone; they rank last.
 */
function qualityRank(v: SpeechSynthesisVoice): number {
  const n = v.name;
  if (/高級|Premium/i.test(n)) return 3;
  if (/進階|增強|Enhanced/i.test(n)) return 2;
  if (/^(Eddy|Flo|Grandma|Grandpa|Reed|Rocko|Sandy|Shelley)\b/.test(n)) return 0;
  return 1;
}

export function pickVoice(
  voices: SpeechSynthesisVoice[],
  gender: SpeechGender | null | undefined,
  age: number | null | undefined,
): SpeechSynthesisVoice | null {
  if (voices.length === 0) return null;
  const band = ageBand(age);
  const key = `${gender === 'female' ? 'female' : gender === 'male' ? 'male' : 'female'}:${band}`;
  const byQuality = (a: SpeechSynthesisVoice, b: SpeechSynthesisVoice) =>
    qualityRank(b) - qualityRank(a);

  // Best installed tier of any preferred name for this bucket. With an enhanced
  // 美佳 installed this returns it over the compact one automatically.
  for (const name of PREFERRED[key] ?? []) {
    const hits = voices.filter((v) => v.name.includes(name)).sort(byQuality);
    if (hits[0]) return hits[0];
  }
  // Nothing preferred: any enhanced/premium voice beats any compact one, and an
  // Eloquence voice only when it is genuinely all that exists.
  const ranked = [...voices].sort(byQuality);
  return ranked.find((v) => v.localService && qualityRank(v) >= 2) ?? ranked[0] ?? null;
}

export interface SpeakOptions {
  voice?: SpeechSynthesisVoice | null;
  lang?: string;
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
  onError?: () => void;
}

/** Speak text through the system synthesiser. Cancels anything already talking. */
export function speak(text: string, options: SpeakOptions = {}): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // Barge-in and turn changes both need the previous utterance gone, not queued.
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(trimmed);
  if (options.voice) utterance.voice = options.voice;
  utterance.lang = options.lang ?? options.voice?.lang ?? 'zh-TW';
  utterance.rate = options.rate ?? 1;
  utterance.pitch = options.pitch ?? 1;
  utterance.onend = () => options.onEnd?.();
  utterance.onerror = () => options.onError?.();
  window.speechSynthesis.speak(utterance);
  return true;
}

export function cancelSpeech(): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
}
