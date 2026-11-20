import { m } from 'motion/react';
import type { ReactNode } from 'react';
import { revealVariants, staggerVariants } from '../lib/motion';
import { useMotionPreference } from './MotionProvider';

const VIEWPORT = { once: true, margin: '0px 0px -8% 0px' } as const;

/**
 * Fade + slide up once, when the block first enters the viewport (also on page load).
 * Use for page sections and cards, never for table rows or form fields.
 */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const { reduced } = useMotionPreference();
  return (
    <m.div className={className} variants={revealVariants} initial={reduced ? false : 'hidden'} whileInView="visible" viewport={VIEWPORT}>
      {children}
    </m.div>
  );
}

/** Parent that reveals its <StaggerItem> children one after another (--stagger-step). */
export function Stagger({ children, className, delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const { reduced } = useMotionPreference();
  return (
    <m.div
      className={className}
      variants={staggerVariants(delay)}
      initial={reduced ? false : 'hidden'}
      whileInView="visible"
      viewport={VIEWPORT}
    >
      {children}
    </m.div>
  );
}

export function StaggerItem({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <m.div className={className} variants={revealVariants}>
      {children}
    </m.div>
  );
}
