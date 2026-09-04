import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { themeNoFlashScript } from '@/components/theme/theme-script';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: {
    default: 'AI Coach — Enterprise Simulation & Assessment',
    template: '%s · AI Coach',
  },
  description:
    'Conversational scenario simulation and talent assessment: personas, RAG-grounded knowledge, voice sessions, evidence-based scoring and compliance review.',
  applicationName: 'AI Coach',
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  /*
   * The only literal colours in this app. `themeColor` paints the browser /
   * OS chrome, which is outside the document, so it cannot read a CSS variable.
   * These two values MUST mirror `--bg-canvas` in design-tokens' tokens.css
   * (light / dark) — everything inside the page uses the variables (§99).
   */
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f7fd' },
    { media: '(prefers-color-scheme: dark)', color: '#07101e' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          §6 — blocking inline script sets `data-theme` before the first paint.
          Without this the page would paint light and then swap, which is exactly
          the full-page flash the spec forbids. ThemeProvider adds the 200ms
          `.theme-transition` class one frame later so only *later* changes animate.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeNoFlashScript }} />
      </head>
      <body>
        {/* §47 — first tab stop skips the icon rail. */}
        <a
          href="#workspace-main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-6 focus:top-6 focus:z-50 focus:rounded-button focus:bg-glass-strong focus:px-4 focus:py-2 focus:text-body-sm focus:shadow-floating"
        >
          Skip to main content
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
