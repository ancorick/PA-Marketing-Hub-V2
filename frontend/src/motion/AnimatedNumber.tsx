import { animate } from 'motion/react';
import { useEffect, useRef } from 'react';
import { duration, ease } from '../lib/motion';
import { useMotionPreference } from './MotionProvider';
import { useInViewOnce } from './useInViewOnce';

/**
 * Counts up from 0 once, when the number first becomes visible. Writes to the DOM directly
 * (no re-render per frame). Screen readers get only the final value; the moving digits are
 * aria-hidden so nothing is announced mid-count. Reduced motion: final value immediately.
 * For KPI tiles only; table cells never count.
 */
export function AnimatedNumber({ value, format }: { value: number; format: (n: number) => string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInViewOnce(ref);
  const { reduced } = useMotionPreference();

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduced) {
      node.textContent = format(value);
      return;
    }
    if (!inView) return;
    const controls = animate(0, value, {
      duration: duration.counter,
      ease: ease.enter,
      onUpdate: (latest) => {
        node.textContent = format(latest);
      },
    });
    return () => controls.stop();
  }, [inView, reduced, value, format]);

  return (
    <>
      <span ref={ref} aria-hidden>
        {format(reduced ? value : 0)}
      </span>
      <span className="visually-hidden">{format(value)}</span>
    </>
  );
}
