import { useEffect, useState, type RefObject } from 'react';

/**
 * True once the element has entered the viewport (minus a 5% bottom margin, so the
 * effect starts when the element is really visible); then stops observing.
 * Plain IntersectionObserver: no Motion dependency for a one-shot check.
 */
export function useInViewOnce(ref: RefObject<Element | null>, rootMargin = '0px 0px -5% 0px') {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, seen, rootMargin]);
  return seen;
}
