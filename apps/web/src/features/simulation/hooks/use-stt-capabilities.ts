'use client';

/**
 * Which speech engines this deployment can offer. Probed once per page load and
 * shared, so the switches beside the microphone can enable "Mac 本機" only when
 * the API says the on-device recogniser is reachable and authorised, and route
 * "說：本地" to the local TTS model only when its server answered the probe.
 */
import { useQuery } from '@tanstack/react-query';

import { endpoints } from '@/lib/api-client';

export interface LocalTtsCapability {
  available: boolean;
  model?: string;
  voices?: string[];
  /** The model has one speaker, so the persona's gender cannot reach the voice. */
  singleSpeaker?: boolean;
  reason?: string;
}

export interface SttCapability {
  default: string;
  cloud: boolean;
  mac: { available: boolean; onDevice?: boolean; authorization?: string; reason?: string };
  /** Text-to-speech side, probed in the same round trip (services/local-tts). */
  tts?: { default: string; local: LocalTtsCapability };
}

export function useSttCapabilities(): SttCapability | null {
  const { data } = useQuery({
    queryKey: ['stt', 'capabilities'],
    queryFn: () => endpoints.sttCapabilities(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  return data ?? null;
}

export function macSttUsable(cap: SttCapability | null): boolean {
  return Boolean(cap?.mac?.available && cap?.mac?.authorization !== 'denied');
}

/** The on-device TTS *model* (not the OS voice) answered the API's health probe. */
export function localTtsUsable(cap: SttCapability | null): boolean {
  return Boolean(cap?.tts?.local?.available);
}

/**
 * The local model speaks with one voice for every persona.
 *
 * Breeze2-VITS ships a single female speaker, so in local mode a 67-year-old
 * male customer answers in a young woman's voice. That is a deliberate choice
 * (HANDOFF §16.16) and the only wrong way to ship it is silently — someone
 * would spend the demo debugging a voice that is working as designed.
 */
export function localTtsSingleVoice(cap: SttCapability | null): boolean {
  return Boolean(cap?.tts?.local?.available && cap?.tts?.local?.singleSpeaker);
}
