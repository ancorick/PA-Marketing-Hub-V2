import { domAnimation, LazyMotion, MotionConfig } from 'motion/react';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

type MotionPreference = {
  /** True when the OS asks for reduced motion or the preview toggle is on. */
  reduced: boolean;
  /** Preview override for the design-system page; null = follow the OS. */
  override: boolean | null;
  setOverride: (value: boolean | null) => void;
};

const MotionPreferenceContext = createContext<MotionPreference>({ reduced: false, override: null, setOverride: () => {} });

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Root of all animation (PRD 14.5):
 * - LazyMotion + domAnimation keeps the bundle small (use `m.*`, never `motion.*`).
 * - MotionConfig reducedMotion="always" when the user asked for less motion: Motion then skips
 *   transform/layout animation and keeps only opacity; our own effects read `reduced` and turn off.
 * - data-motion="reduce" on <html> mirrors the state for CSS (tokens.css, base.css).
 */
export function MotionProvider({ children }: { children: ReactNode }) {
  const [systemReduced, setSystemReduced] = useState(() => window.matchMedia(QUERY).matches);
  const [override, setOverride] = useState<boolean | null>(null);

  useEffect(() => {
    const query = window.matchMedia(QUERY);
    const onChange = () => setSystemReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  const reduced = override ?? systemReduced;

  useEffect(() => {
    if (reduced) document.documentElement.setAttribute('data-motion', 'reduce');
    else document.documentElement.removeAttribute('data-motion');
  }, [reduced]);

  const value = useMemo(() => ({ reduced, override, setOverride }), [reduced, override]);

  return (
    <MotionPreferenceContext.Provider value={value}>
      <LazyMotion features={domAnimation} strict>
        <MotionConfig reducedMotion={reduced ? 'always' : 'never'}>{children}</MotionConfig>
      </LazyMotion>
    </MotionPreferenceContext.Provider>
  );
}

export function useMotionPreference() {
  return useContext(MotionPreferenceContext);
}

/** Pointer effects (tilt, spotlight) only make sense with a fine pointer that can hover. */
export function useFinePointer() {
  const [fine, setFine] = useState(() => window.matchMedia('(hover: hover) and (pointer: fine)').matches);
  useEffect(() => {
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    const onChange = () => setFine(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return fine;
}
