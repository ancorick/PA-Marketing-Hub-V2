import { ArrowDown, ArrowUp, Minus } from '@phosphor-icons/react';
import { lazy, Suspense, type ReactNode } from 'react';
import { formatPercent, SMALL_NUMBER_TEXT } from '../lib/format';
import { useT } from '../lib/i18n';
import { AnimatedNumber } from '../motion/AnimatedNumber';
import { Tilt } from '../motion/Tilt';
import type { BrandTone } from './HighlightCard';
import { Tooltip } from './Tooltip';

type StatTileProps = {
  label: string;
  /** Already formatted value, or null when suppressed by the small-number rule (ANL-14). */
  value: string | null;
  /** Relative change vs the previous period, e.g. 0.12 for +12%. */
  delta?: number;
  /** Whether an increase is good (subscribers) or bad (unsubscribes). */
  higherIsBetter?: boolean;
  /** Metric definition and attribution model, shown on hover and focus (PRD 13.7). */
  definition: string;
  /** Link to the data behind the number (ANL-15). */
  href?: string;
  locale?: string;
  /** Brand fill for the one or two tiles that matter most; default is a dark surface. */
  tone?: BrandTone;
  /** Count up to this number when the tile appears (KPI tiles only). `value` stays the fallback. */
  countTo?: { value: number; format: (n: number) => string };
  /** Short line under the value that says what the number covers ("Active, with newsletter consent"). */
  caption?: ReactNode;
  /** Recent values for a mini trend line; the caption or delta carries the numbers. */
  spark?: number[];
};

/** The chart kit loads with the first tile that has a trend line, never in the main bundle. */
const Sparkline = lazy(() => import('../charts').then((mod) => ({ default: mod.Sparkline })));

export function StatTile({ label, value, delta, higherIsBetter = true, definition, href, locale, tone, countTo, caption, spark }: StatTileProps) {
  const t = useT();
  let deltaNode = null;
  if (delta !== undefined) {
    const direction = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const good = direction === 'flat' ? 'flat' : (direction === 'up') === higherIsBetter ? 'up' : 'down';
    const Icon = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : Minus;
    const words = direction === 'up' ? t('tile.up') : direction === 'down' ? t('tile.down') : t('tile.noChange');
    deltaNode = (
      <span className={`delta delta--${good}`}>
        <Icon size={14} weight="bold" aria-hidden />
        <span className="visually-hidden">{words} </span>
        {formatPercent(Math.abs(delta), locale, { signDisplay: 'never' })}
        <span className="visually-hidden"> {t('tile.vsPrevious')}</span>
      </span>
    );
  }

  return (
    <Tilt className={tone ? `tile card--${tone}` : 'tile'} max={4}>
      <span className="tile__label">
        {label}
        <Tooltip label={t('tip.definitionOf', { name: label })}>{definition}</Tooltip>
      </span>
      {value === null ? (
        <span className="tile__value tile__value--suppressed">{SMALL_NUMBER_TEXT}</span>
      ) : (
        <span className="tile__value">{countTo ? <AnimatedNumber value={countTo.value} format={countTo.format} /> : value}</span>
      )}
      {caption && <span className="tile__caption">{caption}</span>}
      {spark && spark.length > 1 && (
        // Decorative: the caption or delta carries the numbers. `inert` also keeps Recharts' layers out of the Tab order.
        <span className="tile__spark" inert>
          <Suspense fallback={<span className="tile__spark-placeholder" />}>
            <Sparkline values={spark} label={t('tile.trend', { name: label })} color={tone ? 'currentColor' : undefined} />
          </Suspense>
        </span>
      )}
      {(deltaNode || href) && (
        <span className="tile__footer">
          {deltaNode ?? <span />}
          {href && (
            <a href={href}>
              {t('tile.seeData')}<span className="visually-hidden"> {t('tile.seeDataFor', { name: label })}</span>
            </a>
          )}
        </span>
      )}
    </Tilt>
  );
}
