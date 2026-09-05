'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiError } from './api-client';

/**
 * §48.5 — TanStack Query owns *server* state only: knowledge, questions, reports,
 * assignments, users. Live session / persona / voice / WebGPU state belongs to
 * Zustand (§48.4) and must not be modelled as queries.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        retry: (failureCount, error) => {
          // 4xx is a contract problem, not a blip — do not hammer the API.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
          return failureCount < 2;
        },
        retryDelay: (attempt) => Math.min(8_000, 500 * 2 ** attempt),
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') return makeQueryClient();
  browserQueryClient ??= makeQueryClient();
  return browserQueryClient;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(getQueryClient);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Stable key factory so invalidation is never spelled by hand. */
export const queryKeys = {
  me: ['me'] as const,
  workspaces: ['workspaces'] as const,
  knowledgeBases: ['knowledge'] as const,
  knowledgeBase: (id: string) => ['knowledge', id] as const,
  documents: (kbId: string) => ['knowledge', kbId, 'documents'] as const,
  document: (kbId: string, docId: string) => ['knowledge', kbId, 'documents', docId] as const,
  chunks: (kbId: string) => ['knowledge', kbId, 'chunks'] as const,
  retrieval: (kbId: string, query: string) => ['knowledge', kbId, 'retrieval', query] as const,
  personas: ['personas'] as const,
  persona: (id: string) => ['personas', id] as const,
  scenarios: ['scenarios'] as const,
  scenario: (id: string) => ['scenarios', id] as const,
  questions: (filter?: string) => ['questions', filter ?? 'all'] as const,
  question: (id: string) => ['questions', id] as const,
  assignments: ['assignments'] as const,
  sessions: ['sessions'] as const,
  session: (id: string) => ['sessions', id] as const,
  sessionReview: (id: string) => ['sessions', id, 'review'] as const,
  skillProfile: (userId: string) => ['reports', 'skills', userId] as const,
  teamReport: ['reports', 'team'] as const,
  complianceReport: ['reports', 'compliance'] as const,
  findings: ['security', 'findings'] as const,
  auditLog: ['security', 'audit'] as const,
  integrations: ['integrations'] as const,
  runtimeTelemetry: ['runtime', 'telemetry'] as const,
  users: ['users'] as const,
  teams: ['teams'] as const,
} as const;
