import {
  Bar,
  BarChart as RBarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart as RLineChart,
  Pie,
  PieChart,
  Rectangle,
  Tooltip,
  type BarShapeProps,
  XAxis,
  YAxis,
} from 'recharts';
import { formatNumber, formatPercent } from '../lib/format';
import { useT } from '../lib/i18n';
import { Disclosure } from '../motion/Disclosure';
import { useMotionPreference } from '../motion/MotionProvider';

/*
 * Chart kit of the design system (RESTRUCTURE §4, MASTER.md §2 "Charts"). One library for the whole app:
 * Recharts 3 (SVG, keyboard and screen-reader layer on by default). Colours come only from the chart tokens,
 * so dark and light themes stay checked; motion follows the reduced-motion preference. This module is loaded
 * only by lazy pages, so Recharts never enters the main bundle.
 */

/** Series colours in order: yellow, aqua, magenta-violet, then green, orange, indigo. */
export const CHART_COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'var(--chart-6)'] as const;

export type Series = { key: string; label: string; color?: string };
export type ValueFormat = (value: number) => string;
const defaultFormat: ValueFormat = (value) => formatNumber(value, undefined, { maximumFractionDigits: 1 });

const AXIS = { fill: 'var(--color-text-subtle)', fontSize: 12 };
const colorOf = (series: Series, index: number) => series.color ?? CHART_COLORS[index % CHART_COLORS.length];

function useAnimate() {
  const { reduced } = useMotionPreference();
  return !reduced;
}

type TooltipRow = { name?: string | number; value?: number | string; color?: string; dataKey?: string | number };
function ChartTooltip({ active, payload, label, format }: { active?: boolean; payload?: TooltipRow[]; label?: string | number; format: ValueFormat }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tooltip">
      {label !== undefined && label !== '' && <p className="chart-tooltip__label">{label}</p>}
      <ul className="chart-tooltip__list">
        {payload.map((row) => (
          <li key={String(row.dataKey ?? row.name)}>
            <span className="chart-tooltip__swatch" style={{ background: row.color }} aria-hidden />
            <span>{row.name}</span>
            <strong className="num">{typeof row.value === 'number' ? format(row.value) : row.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChartLegend({ series }: { series: Series[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="chart-legend" aria-hidden>
      {series.map((item, index) => (
        <li key={item.key}>
          <span className="chart-legend__swatch" style={{ background: colorOf(item, index) }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** Column chart (vertical bars) or bar chart (horizontal bars, `layout="horizontal"`), one or more series. */
export function BarChart<Row extends Record<string, unknown>>({
  data,
  categoryKey,
  series,
  layout = 'vertical',
  height = 280,
  format = defaultFormat,
  stacked = false,
  label,
}: {
  data: Row[];
  categoryKey: keyof Row & string;
  series: Series[];
  /** vertical = columns; horizontal = bars with the category on the left (rankings). */
  layout?: 'vertical' | 'horizontal';
  height?: number;
  format?: ValueFormat;
  stacked?: boolean;
  /** Accessible name of the chart. */
  label: string;
}) {
  const animate = useAnimate();
  const horizontal = layout === 'horizontal';
  const rows = horizontal ? Math.max(data.length, 1) : 0;
  // Rounded data ends (4px), at the far end from the baseline.
  const ends: [number, number, number, number] = horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0];
  // For each row, the last series with a value: the segment that ends the stack.
  const topOf = data.map((row) => series.reduce((top, item, i) => (Number(row[item.key] ?? 0) > 0 ? i : top), -1));
  // Each category needs room for all its bars; long names are shortened on the axis, the tooltip has them whole.
  const rowHeight = series.length > 1 && !stacked ? 18 * series.length + 14 : 34;
  const shortName = (value: unknown) => {
    const text = String(value);
    return text.length > 24 ? `${text.slice(0, 23)}…` : text;
  };
  return (
    <div className="chart-frame">
      <ChartLegend series={series} />
      <RBarChart
        responsive
        style={{ width: '100%', height: horizontal ? Math.max(height, rows * rowHeight + 24) : height }}
        data={data}
        layout={horizontal ? 'vertical' : 'horizontal'}
        margin={{ top: 8, right: horizontal ? 48 : 8, bottom: 0, left: 0 }}
        accessibilityLayer
        role="img"
        aria-label={label}
      >
        <CartesianGrid stroke="var(--chart-grid)" vertical={horizontal} horizontal={!horizontal} />
        {horizontal ? (
          <>
            <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} tickFormatter={format} />
            <YAxis type="category" dataKey={categoryKey as never} tick={AXIS} axisLine={false} tickLine={false} width={160} tickFormatter={shortName} />
          </>
        ) : (
          <>
            <XAxis dataKey={categoryKey as never} tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
            <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={format} width={48} />
          </>
        )}
        <Tooltip cursor={{ fill: 'var(--color-surface-chip)' }} content={<ChartTooltip format={format} />} />
        {series.map((item, index) => (
          <Bar
            key={item.key}
            dataKey={item.key}
            name={item.label}
            fill={colorOf(item, index)}
            stackId={stacked ? 'stack' : undefined}
            radius={stacked ? 0 : ends}
            // Stacks: a 2px gap in the surface colour between segments, and only the top segment of each
            // column is rounded (the data end), never the joints inside the stack.
            shape={stacked ? (props: BarShapeProps) => <Rectangle {...(props as object)} radius={topOf[props.index] === index ? ends : 0} /> : undefined}
            stroke={stacked ? 'var(--color-surface)' : undefined}
            strokeWidth={stacked ? 1 : 0}
            maxBarSize={horizontal ? 22 : 40}
            isAnimationActive={animate}
          >
            {horizontal && series.length === 1 && <LabelList dataKey={item.key} position="right" formatter={(value) => format(Number(value))} className="chart-value-label" />}
          </Bar>
        ))}
      </RBarChart>
    </div>
  );
}

/** Line chart with one or more series over time; the last point of each line is labelled directly. */
export function LineChart<Row extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height = 280,
  format = defaultFormat,
  label,
}: {
  data: Row[];
  xKey: keyof Row & string;
  series: Series[];
  height?: number;
  format?: ValueFormat;
  label: string;
}) {
  const animate = useAnimate();
  // Dashes tell the lines apart without colour (MASTER.md §2 Charts).
  const dashes = [undefined, '6 4', '2 3', '8 3 2 3', '12 4', undefined];
  return (
    <div className="chart-frame">
      <ChartLegend series={series} />
      <RLineChart responsive style={{ width: '100%', height }} data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }} accessibilityLayer role="img" aria-label={label}>
        <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
        <XAxis dataKey={xKey as never} tick={AXIS} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tick={AXIS} axisLine={false} tickLine={false} tickFormatter={format} width={48} />
        <Tooltip cursor={{ stroke: 'var(--color-border-strong)' }} content={<ChartTooltip format={format} />} />
        {series.map((item, index) => (
          <Line
            key={item.key}
            type="monotone"
            dataKey={item.key}
            name={item.label}
            stroke={colorOf(item, index)}
            strokeWidth={2.5}
            strokeDasharray={dashes[index % dashes.length]}
            dot={false}
            activeDot={{ r: 5 }}
            isAnimationActive={animate}
          />
        ))}
      </RLineChart>
    </div>
  );
}

/**
 * Funnel (Leads → Applied → Enrolled → Completed → Hired): horizontal bars in one colour getting narrower, each
 * stage with its value and the conversion from the previous step as text (not colour alone).
 */
export function FunnelChart({ stages, format = defaultFormat, label, color = CHART_COLORS[0] }: { stages: { label: string; value: number }[]; format?: ValueFormat; label: string; color?: string }) {
  const t = useT();
  const max = Math.max(...stages.map((stage) => stage.value), 1);
  return (
    <ol className="funnel" aria-label={label}>
      {stages.map((stage, index) => {
        const previous = stages[index - 1]?.value;
        const conversion = previous ? stage.value / previous : null;
        return (
          <li key={stage.label} className="funnel__stage">
            <span className="funnel__label">{stage.label}</span>
            <span className="funnel__track">
              <span className="funnel__bar" style={{ width: `${Math.max((stage.value / max) * 100, stage.value > 0 ? 2 : 0)}%`, background: color }} />
            </span>
            <span className="funnel__value num">{format(stage.value)}</span>
            <span className="funnel__conversion num">
              {conversion === null ? '' : `${formatPercent(conversion, undefined, { maximumFractionDigits: 1 })} ${t('chart.ofPrevious')}`}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Donut for part-to-whole with at most six slices; every slice is listed with its value and share. */
export function DonutChart({
  data,
  format = defaultFormat,
  label,
  centerLabel,
}: {
  data: { label: string; value: number; color?: string }[];
  format?: ValueFormat;
  label: string;
  /** Text in the hole, e.g. the total. */
  centerLabel?: string;
}) {
  const animate = useAnimate();
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const slices = data.slice(0, 6).map((item, index) => ({ ...item, color: item.color ?? CHART_COLORS[index % CHART_COLORS.length] }));
  return (
    <div className="donut">
      <div className="donut__chart">
        <PieChart responsive style={{ width: '100%', height: 200 }} accessibilityLayer role="img" aria-label={label}>
          <Pie data={slices} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none" isAnimationActive={animate}>
            {slices.map((slice) => (
              <Cell key={slice.label} fill={slice.color} />
            ))}
          </Pie>
          <Tooltip content={<ChartTooltip format={format} />} />
        </PieChart>
        {centerLabel && (
          <span className="donut__center num" aria-hidden>
            {centerLabel}
          </span>
        )}
      </div>
      <ul className="donut__legend">
        {slices.map((slice) => (
          <li key={slice.label}>
            <span className="chart-legend__swatch" style={{ background: slice.color }} aria-hidden />
            <span className="donut__name">{slice.label}</span>
            <span className="num">{format(slice.value)}</span>
            <span className="muted num">{total > 0 ? formatPercent(slice.value / total, undefined, { maximumFractionDigits: 0 }) : '—'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Tiny trend line for a metric tile: no axes; the tile's text carries the numbers. */
export function Sparkline({ values, color = CHART_COLORS[1], label }: { values: number[]; color?: string; label: string }) {
  const data = values.map((value, index) => ({ index, value }));
  return (
    <RLineChart responsive style={{ width: '100%', height: 36 }} data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }} accessibilityLayer={false} role="img" aria-label={label}>
      <Line type="monotone" dataKey="value" stroke={color} strokeWidth={2} dot={false} isAnimationActive={false} />
    </RLineChart>
  );
}

type Point = { label: string; value: number };

/** The same data as a table, behind "Show data as a table" (PRD 14.5: every chart has a table alternative). */
function PointTable({ caption, data, unit, labelHeader }: { caption: string; data: Point[]; unit: string; labelHeader?: string }) {
  const t = useT();
  return (
    <Disclosure title={t('chart.showTable')}>
      <div className="table-wrap">
        <table className="table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{labelHeader ?? t('chart.month')}</th>
              <th scope="col" className="is-num">
                {unit}
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.label}>
                <th scope="row">{d.label}</th>
                <td className="is-num">{formatNumber(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Disclosure>
  );
}

/** One series of columns by label, with its summary and table (Channel trend, design-system preview). */
export function SimpleBarChart({ data, unit, summary, labelHeader }: { data: Point[]; unit: string; summary: string; labelHeader?: string }) {
  return (
    <figure className="chart">
      <BarChart data={data} categoryKey="label" series={[{ key: 'value', label: unit }]} label={summary} height={220} />
      <figcaption>{summary}</figcaption>
      <PointTable caption={summary} data={data} unit={unit} labelHeader={labelHeader} />
    </figure>
  );
}

/** One line by label, with its summary and table. */
export function SimpleLineChart({ data, unit, summary, labelHeader }: { data: Point[]; unit: string; summary: string; labelHeader?: string }) {
  return (
    <figure className="chart">
      <LineChart data={data} xKey="label" series={[{ key: 'value', label: unit, color: CHART_COLORS[1] }]} label={summary} height={220} />
      <figcaption>{summary}</figcaption>
      <PointTable caption={summary} data={data} unit={unit} labelHeader={labelHeader} />
    </figure>
  );
}
