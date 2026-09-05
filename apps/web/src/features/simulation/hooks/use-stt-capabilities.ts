'use client';

/**
 * Which recognisers this deployment can offer. Probed once per page load and
 * shared, so the switch beside the microphone can enable "Mac 本機" only when
 * the API says the on-device daemon is reachable and authorised.
 */
import { useQuery } from '@tanstack/react-query';

import { endpoints } from '@/lib/api-client';

export interface SttCapability {
  default: string;
  cloud: boolean;
  mac: { available: boolean; onDevice?: boolean; authorization?: string; reason?: string };
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
