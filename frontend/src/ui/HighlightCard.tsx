import { ArrowUpRight } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Tilt } from '../motion/Tilt';

export type BrandTone = 'yellow' | 'aqua' | 'magenta';

/**
 * Big brand-filled card that links somewhere (concept top row). Use at most one row per page,
 * for the 2–4 most important entry points. Color is decoration only: the text carries the meaning.
 * Hover: lift + brand glow (CSS); pointer: tilt + spotlight (Tilt).
 */
export function HighlightCard({
  tone,
  badge,
  title,
  description,
  href,
}: {
  tone: BrandTone;
  badge?: ReactNode;
  title: string;
  description?: string;
  href: string;
}) {
  return (
    <Tilt as="article" className={`card card--${tone} highlight`}>
      <div className="highlight__top">
        <div className="stack stack--sm">
          {badge}
          <h3 className="highlight__title">
            <a href={href}>{title}</a>
          </h3>
        </div>
        <span className="arrow-btn" aria-hidden>
          <ArrowUpRight size={18} weight="bold" />
        </span>
      </div>
      {description && <p className="highlight__desc">{description}</p>}
    </Tilt>
  );
}
