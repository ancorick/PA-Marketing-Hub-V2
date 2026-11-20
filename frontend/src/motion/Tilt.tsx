import { m, useSpring } from 'motion/react';
import { useRef, type PointerEvent, type ReactNode } from 'react';
import { spring, tiltMax } from '../lib/motion';
import { useFinePointer, useMotionPreference } from './MotionProvider';

type TiltProps = {
  children: ReactNode;
  className?: string;
  as?: 'div' | 'article';
  /** Rotate toward the cursor (brand cards, tiles). Off = spotlight glow only (dark item cards). */
  tilt?: boolean;
  max?: number;
};

/**
 * Pointer-following effect: a soft glow under the cursor (CSS vars → .spotlight) and an optional
 * 3D tilt driven by springs. No React re-renders on pointer move. Disabled for reduced motion and
 * touch/coarse pointers. Use on a few large cards per view, never on table rows or form controls.
 */
export function Tilt({ children, className = '', as = 'div', tilt = true, max = tiltMax }: TiltProps) {
  const { reduced } = useMotionPreference();
  const fine = useFinePointer();
  const enabled = fine && !reduced;
  const rotateX = useSpring(0, spring.pointer);
  const rotateY = useSpring(0, spring.pointer);
  const frame = useRef(0);

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (!enabled) return;
    const node = event.currentTarget;
    const { clientX, clientY } = event;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const rect = node.getBoundingClientRect();
      const x = (clientX - rect.left) / rect.width;
      const y = (clientY - rect.top) / rect.height;
      node.style.setProperty('--spot-x', `${(x * 100).toFixed(1)}%`);
      node.style.setProperty('--spot-y', `${(y * 100).toFixed(1)}%`);
      if (tilt) {
        rotateY.set((x - 0.5) * 2 * max);
        rotateX.set(-(y - 0.5) * 2 * max);
      }
    });
  };

  const onPointerLeave = () => {
    cancelAnimationFrame(frame.current);
    rotateX.set(0);
    rotateY.set(0);
  };

  const Component = as === 'article' ? m.article : m.div;
  return (
    <Component
      className={`${className} ${enabled ? 'spotlight' : ''} ${enabled && tilt ? 'tilt' : ''}`.trim()}
      style={enabled && tilt ? { rotateX, rotateY, transformPerspective: 900 } : undefined}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      {children}
    </Component>
  );
}
