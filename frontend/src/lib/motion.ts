import { stagger, type Transition, type Variants } from 'motion/react';

/**
 * Motion tokens for Motion (JS). Mirror of the --duration-* / --ease-* / --stagger-step tokens in
 * src/styles/tokens.css. Change both together. Seconds here, milliseconds in CSS.
 */
export const duration = {
  instant: 0.1,
  fast: 0.15,
  base: 0.2,
  moderate: 0.25,
  slow: 0.4,
  counter: 0.9,
} as const;

export const ease = {
  standard: [0.2, 0, 0, 1],
  enter: [0, 0, 0.2, 1],
  exit: [0.4, 0, 1, 1],
  emphasized: [0.2, 0.9, 0.1, 1.05],
} as const satisfies Record<string, [number, number, number, number]>;

export const staggerStep = 0.04;
export const revealDistance = 12;
export const tiltMax = 6;

/** Springs for pointer-driven effects (tilt). Physical, interruptible. */
export const spring = {
  pointer: { stiffness: 260, damping: 26, mass: 0.6 },
} as const;

/** Exit runs at ~70% of enter (MASTER.md §6). */
export const exitOf = (enterSeconds: number) => Math.round(enterSeconds * 0.7 * 1000) / 1000;

/** Fade + slide up. Used by <Reveal> and <Stagger> children. */
export const revealVariants: Variants = {
  hidden: { opacity: 0, y: revealDistance },
  visible: { opacity: 1, y: 0, transition: { duration: duration.slow, ease: ease.enter } },
};

/** Parent that staggers its children by --stagger-step. */
export const staggerVariants = (startDelay = 0): Variants => ({
  hidden: {},
  visible: { transition: { delayChildren: stagger(staggerStep, { startDelay }) } },
});

/** Page change: short crossfade with a 6px rise; exit faster than enter. */
export const pageTransition = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.enter } as Transition },
  exit: { opacity: 0, y: -4, transition: { duration: exitOf(duration.base), ease: ease.exit } as Transition },
};

/** Menus and popovers grow from their trigger. */
export const popoverTransition = {
  initial: { opacity: 0, scale: 0.96, y: -4 },
  animate: { opacity: 1, scale: 1, y: 0, transition: { duration: duration.base, ease: ease.enter } as Transition },
  exit: { opacity: 0, scale: 0.98, y: -2, transition: { duration: exitOf(duration.base), ease: ease.exit } as Transition },
};
