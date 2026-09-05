'use client';

/**
 * Transcript auto-scroll that yields to the reader.
 *
 * While the reader is pinned to the bottom, new turns and streaming deltas keep
 * the view at the newest content. As soon as they scroll up (to re-read an
 * earlier objection, for instance) auto-scroll stops and a "jump to latest"
 * affordance takes over — scroll position is never stolen back from the user.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const PIN_THRESHOLD_PX = 56;

export interface AutoScroll<T extends HTMLElement> {
  /** Structural ref type so this compiles under both React 18 and 19 typings. */
  containerRef: { current: T | null };
  /** True while the view is following the newest content. */
  pinned: boolean;
  /** True when there is unseen content below the viewport. */
  hasUnseen: boolean;
  scrollToBottom: (behaviour?: ScrollBehavior) => void;
}

export function useAutoScroll<T extends HTMLElement>(
  /** Anything that means "content grew" — turn count, partial length, … */
  dependency: unknown,
  enabled = true,
): AutoScroll<T> {
  const containerRef = useRef<T | null>(null);
  const pinnedRef = useRef(true);
  const [pinned, setPinned] = useState(true);
  const [hasUnseen, setHasUnseen] = useState(false);

  const measure = useCallback((): boolean => {
    const el = containerRef.current;
    if (!el) return true;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    return distance <= PIN_THRESHOLD_PX;
  }, []);

  const scrollToBottom = useCallback((behaviour: ScrollBehavior = 'smooth') => {
    const el = containerRef.current;
    if (!el) return;
    pinnedRef.current = true;
    setPinned(true);
    setHasUnseen(false);
    try {
      el.scrollTo({ top: el.scrollHeight, behavior: behaviour });
    } catch {
      // Older engines without ScrollToOptions support.
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // Track the reader's intent.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const atBottom = measure();
        pinnedRef.current = atBottom;
        setPinned(atBottom);
        if (atBottom) setHasUnseen(false);
      });
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [measure]);

  // Follow new content only while pinned.
  useEffect(() => {
    if (!enabled) return;
    const el = containerRef.current;
    if (!el) return;
    if (pinnedRef.current) {
      el.scrollTop = el.scrollHeight;
      setHasUnseen(false);
    } else {
      setHasUnseen(true);
    }
  }, [dependency, enabled]);

  return { containerRef, pinned, hasUnseen, scrollToBottom };
}
