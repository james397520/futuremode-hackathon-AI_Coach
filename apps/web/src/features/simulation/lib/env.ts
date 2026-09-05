/**
 * Backend presence for the simulation screens.
 *
 * This module used to re-derive `NEXT_PUBLIC_API_BASE_URL` on its own, with an
 * empty-string default, and treated "unset" as "no backend" — which silently
 * swapped the live persona for the scripted demo while the REST calls kept
 * hitting the real API. It is now a thin view over the single source of truth.
 */
export {
  API_BASE_URL,
  WS_BASE_URL,
  hasBackend,
  shouldUseMockStream,
} from '@/lib/runtime-env';
