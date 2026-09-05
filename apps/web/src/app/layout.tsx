import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { themeNoFlashScript } from '@/components/theme/theme-script';
import { Providers } from './providers';

export const metadata: Metadata = {
  title: {
    default: 'AI Coach — 企業對話模擬與人才評測',
    template: '%s · AI Coach',
  },
  description:
    '對話式情境模擬與人才評測平台：模擬人物、RAG 知識依據、語音練習、有憑有據的評分與合規審查。',
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
    { media: '(prefers-color-scheme: light)', color: '#ccc8fe' },
    { media: '(prefers-color-scheme: dark)', color: '#17151f' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-Hant" suppressHydrationWarning>
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
          className="sr-only focus:not-sr-only focus:fixed focus:left-6 focus:top-6 focus:z-50 focus:rounded-button focus:bg-glass-card focus:px-4 focus:py-2 focus:text-body-sm focus:shadow-floating focus:backdrop-blur-card"
        >
          跳至主要內容
        </a>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
