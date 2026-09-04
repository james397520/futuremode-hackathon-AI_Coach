/**
 * Next.js config — spec §73 (Browser security) / §97 (WebGPU security & privacy UX) / §96 (bundle).
 *
 * Two things drive the CSP shape here:
 *   1. The local inference worker (§58 WebGPU Worker) is instantiated from a `blob:` URL,
 *      so `worker-src` and `child-src` must allow `blob:`.
 *   2. WASM fallback inference (§62) compiles WebAssembly at runtime, which requires
 *      `wasm-unsafe-eval` in `script-src`. We deliberately do NOT ship a blanket
 *      `unsafe-eval` in production.
 *
 * Secrets (OpenAI / ElevenLabs keys) never reach the browser — §56 / §70 / §71.
 * There is therefore no allowance for calling model providers directly from the page:
 * `connect-src` only lists our own API / WS origins.
 */

const isDev = process.env.NODE_ENV !== 'production';

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:8000';
const wsBase = process.env.NEXT_PUBLIC_WS_BASE_URL ?? 'ws://localhost:8000';

/**
 * Avatar Runtime (LivePortrait + MuseTalk) — a local, loopback-only process.
 * The browser talks to it over HTTP (`/health`, `/capabilities`, `/sessions`) and
 * WebSocket (`/ws/sessions/{id}`, carrying §45 control events + JPEG/WebP frames),
 * so both origins must be in `connect-src` or the requests are blocked silently.
 * It is optional: these entries only *permit* an origin, they do not require one
 * to exist.
 */
const avatarBase = process.env.NEXT_PUBLIC_AVATAR_BASE_URL ?? 'http://127.0.0.1:8765';
const avatarWsBase =
  process.env.NEXT_PUBLIC_AVATAR_WS_URL ?? avatarBase.replace(/^http/, 'ws');

/** Model files for local inference are served from our own origin / API by default. */
const connectSources = ["'self'", apiBase, wsBase, avatarBase, avatarWsBase, 'blob:', 'data:'].filter(
  Boolean,
);

const csp = [
  "default-src 'self'",
  // `wasm-unsafe-eval` = WASM inference fallback. `blob:` = worker bootstrap.
  // Dev additionally needs `unsafe-eval` for React Refresh.
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:${isDev ? " 'unsafe-eval'" : ''}`,
  // The no-flash theme bootstrap script and Tailwind's injected styles are inline.
  "style-src 'self' 'unsafe-inline'",
  // `avatarBase` so the runtime's prepared portrait (§7) can be shown by the
  // §53 fallback — it is served over plain http on loopback, which `https:` misses.
  `img-src 'self' data: blob: https: ${avatarBase}`,
  "font-src 'self' data:",
  // Persona TTS audio arrives as blob / object URLs (§50 Audio Architecture).
  // The avatar origin is listed for the Phase-2 WebRTC / MSE video path; the
  // Phase-1 frame path paints a canvas and needs nothing here.
  `media-src 'self' blob: data: ${avatarBase}`,
  `connect-src ${connectSources.join(' ')}`,
  // §58 — the WebGPU/WASM worker is created from a blob URL.
  "worker-src 'self' blob:",
  "child-src 'self' blob:",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  // Only in production: this tells the browser to silently rewrite every
  // subresource fetch (CSS/JS/img/...) from http:// to https://. Chrome
  // exempts `localhost`, but NOT a LAN IP like 192.168.x.x reached over
  // plain http in dev — there every stylesheet request gets rewritten to
  // an https:// origin that doesn't exist and fails with no visible error,
  // so the page renders as unstyled text. §73 only requires this in
  // production, where the deployment is actually behind TLS.
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: csp },
  // HTTPS only (§73) — production only, for the same reason as
  // `upgrade-insecure-requests` above: this header is meaningless (and, in
  // Safari particularly, can be actively harmful) on a plain-http dev server.
  ...(isDev
    ? []
    : [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' }]),
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Permissions-Policy',
    // Microphone + camera are used by voice / optional avatar mode (§22 / §76).
    value: 'microphone=(self), camera=(self), geolocation=(), payment=()',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: [
    '@ai-coach/ui',
    '@ai-coach/design-tokens',
    '@ai-coach/shared',
    '@ai-coach/ai-runtime',
  ],
  experimental: {
    optimizePackageImports: ['lucide-react'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
