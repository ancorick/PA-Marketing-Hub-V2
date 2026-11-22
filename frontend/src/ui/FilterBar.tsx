import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useT } from '../lib/i18n';
import { PERIOD_PRESETS, presetOf, presetRange, type DateRange } from '../lib/periods';
import { Tooltip } from './Tooltip';

/**
 * Filter panel under the page header (RESTRUCTURE §4): stays visible while the page scrolls, so the period and
 * model behind every number are always on screen.
 */
export function FilterBar({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // The sticky panel must not hide the control that has keyboard focus (WCAG 2.4.11): its height feeds the
  // page's scroll-padding, so focused elements and anchors scroll into view below it.
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const update = () => {
      const sticky = getComputedStyle(element).position === 'sticky';
      root.style.setProperty('--filterbar-height', sticky ? `${element.offsetHeight}px` : '0px');
    };
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener('resize', update);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
      root.style.removeProperty('--filterbar-height');
    };
  }, []);
  return (
    <div ref={ref} className="filterbar" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** Period presets (30 days … 12 months) plus a custom range with two dates. */
export function PeriodFilter({ value, onChange }: { value: DateRange; onChange: (range: DateRange) => void }) {
  const t = useT();
  const [customOpen, setCustomOpen] = useState(false);
  const matched = presetOf(value);
  const preset = customOpen ? 'custom' : matched;
  return (
    <div className="filter">
      <span className="filter__label" id="filter-period">
        {t('filter.period')}
      </span>
      <div className="segmented segmented--compact" role="group" aria-labelledby="filter-period">
        {PERIOD_PRESETS.map((option) => (
          <button key={option.id} type="button" className="segmented__btn" aria-pressed={preset === option.id} onClick={() => {
              setCustomOpen(false);
              onChange(presetRange(option.id));
            }}
          >
            {t(option.label)}
          </button>
        ))}
        <button type="button" className="segmented__btn" aria-pressed={preset === 'custom'} onClick={() => setCustomOpen(true)}>
          {t('filter.custom')}
        </button>
      </div>
      {preset === 'custom' && (
        <span className="filter__dates">
          <label>
            <span className="visually-hidden">{t('filter.from')}</span>
            <input className="input input--sm" type="date" value={value.from} max={value.to} onChange={(event) => event.target.value && onChange({ ...value, from: event.target.value })} />
          </label>
          <span aria-hidden>–</span>
          <label>
            <span className="visually-hidden">{t('filter.to')}</span>
            <input className="input input--sm" type="date" value={value.to} min={value.from} onChange={(event) => event.target.value && onChange({ ...value, to: event.target.value })} />
          </label>
        </span>
      )}
    </div>
  );
}

export type AttributionModel = 'first_touch' | 'last_touch' | 'position_based';

/** Attribution model select; the model is named in every answer and never mixed (PRD 9.4). */
export function AttributionFilter({ value, onChange }: { value: AttributionModel; onChange: (model: AttributionModel) => void }) {
  const t = useT();
  return (
    <label className="filter">
      <span className="filter__label">{t('filter.attribution')}</span>
      <select className="select select--sm" value={value} onChange={(event) => onChange(event.target.value as AttributionModel)}>
        <option value="first_touch">{t('filter.firstTouch')}</option>
        <option value="last_touch">{t('filter.lastTouch')}</option>
        <option value="position_based">{t('filter.positionBased')}</option>
      </select>
    </label>
  );
}

export type ViewMode = 'period' | 'cohort';

/** Period / Cohort switch where a page offers both readings of the same numbers. */
export function ViewToggle({ value, onChange }: { value: ViewMode; onChange: (view: ViewMode) => void }) {
  const t = useT();
  return (
    <div className="filter">
      <span className="filter__label" id="filter-view">
        {t('filter.view')}
      </span>
      <div className="segmented segmented--compact" role="group" aria-labelledby="filter-view">
        <button type="button" className="segmented__btn" aria-pressed={value === 'period'} onClick={() => onChange('period')}>
          {t('filter.viewPeriod')}
        </button>
        <button type="button" className="segmented__btn" aria-pressed={value === 'cohort'} onClick={() => onChange('cohort')}>
          {t('filter.viewCohort')}
        </button>
      </div>
      <Tooltip label={t('filter.view')}>{t('filter.viewHint')}</Tooltip>
    </div>
  );
}
