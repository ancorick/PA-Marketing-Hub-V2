import { m } from 'motion/react';
import { duration, ease, staggerStep } from '../lib/motion';
import { formatNumber } from '../lib/format';
import { Disclosure } from './Disclosure';
import { useMotionPreference } from './MotionProvider';

export type Point = { label: string; value: number };

const W = 600;
const H = 200;
const PAD = { top: 24, right: 12, bottom: 28, left: 12 };
const VIEWPORT = { once: true, margin: '0px 0px -10% 0px' } as const;

function scaleY(value: number, max: number) {
  return PAD.top + (H - PAD.top - PAD.bottom) * (1 - value / max);
}

/** Visible data table under every chart (PRD 14.5: charts have a table alternative). */
function DataTableAlt({ caption, data, unit, labelHeader = 'Month' }: { caption: string; data: Point[]; unit: string; labelHeader?: string }) {
  return (
    <Disclosure title="Show data as a table">
      <div className="table-wrap">
        <table className="table">
          <caption className="visually-hidden">{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{labelHeader}</th>
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

/**
 * Column chart: bars grow from the baseline once, staggered by --stagger-step, when the chart
 * enters the viewport. The last bar is highlighted and labelled directly. Reduced motion: static.
 */
export function BarChart({ data, summary, unit, colorVar = '--chart-1', labelHeader }: { data: Point[]; summary: string; unit: string; colorVar?: string; labelHeader?: string }) {
  const { reduced } = useMotionPreference();
  // All zeros: keep a flat baseline instead of dividing by zero.
  const max = Math.max(...data.map((d) => d.value), 1) * 1.1;
  const slot = (W - PAD.left - PAD.right) / data.length;
  const barW = slot * 0.56;
  const last = data.length - 1;

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden>
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <line key={t} className="chart__grid" x1={PAD.left} x2={W - PAD.right} y1={scaleY(max * t, max)} y2={scaleY(max * t, max)} />
        ))}
        <m.g initial={reduced ? false : 'hidden'} whileInView="visible" viewport={VIEWPORT}>
          {data.map((d, i) => {
            const x = PAD.left + slot * i + (slot - barW) / 2;
            const y = scaleY(d.value, max);
            return (
              <m.rect
                key={d.label}
                x={x}
                y={y}
                width={barW}
                height={H - PAD.bottom - y}
                rx={6}
                fill={`var(${colorVar})`}
                opacity={i === last ? 1 : 0.55}
                style={{ transformBox: 'fill-box', originY: 1 }}
                variants={{
                  hidden: { scaleY: 0 },
                  visible: { scaleY: 1, transition: { duration: duration.counter, ease: ease.enter, delay: i * staggerStep } },
                }}
              />
            );
          })}
        </m.g>
        {data.map((d, i) => (
          <text key={d.label} className="chart__axis" x={PAD.left + slot * i + slot / 2} y={H - 8} textAnchor="middle">
            {d.label}
          </text>
        ))}
        <text className="chart__label" x={PAD.left + slot * last + slot / 2} y={scaleY(data[last]?.value ?? 0, max) - 8} textAnchor="middle">
          {formatNumber(data[last]?.value ?? 0)}
        </text>
      </svg>
      <figcaption>{summary}</figcaption>
      <DataTableAlt caption={summary} data={data} unit={unit} labelHeader={labelHeader} />
    </figure>
  );
}

/**
 * Line chart: the line draws itself (pathLength 0 → 1), then the area fades in and the end
 * point appears with a direct label. Reduced motion: static.
 */
export function LineChart({ data, summary, unit, colorVar = '--chart-2' }: { data: Point[]; summary: string; unit: string; colorVar?: string }) {
  const { reduced } = useMotionPreference();
  const max = Math.max(...data.map((d) => d.value)) * 1.1;
  const min = Math.min(...data.map((d) => d.value)) * 0.9;
  const step = (W - PAD.left - PAD.right) / (data.length - 1);
  const y = (v: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - (v - min) / (max - min));
  const points = data.map((d, i) => [PAD.left + step * i, y(d.value)] as const);
  const line = points.map(([px, py], i) => `${i === 0 ? 'M' : 'L'}${px.toFixed(1)},${py.toFixed(1)}`).join(' ');
  const area = `${line} L${W - PAD.right},${H - PAD.bottom} L${PAD.left},${H - PAD.bottom} Z`;
  const end = points[points.length - 1] ?? [0, 0];
  const gradientId = `area-${colorVar.replace(/[^a-z0-9]/gi, '')}`;

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={`var(${colorVar})`} stopOpacity="0.35" />
            <stop offset="100%" stopColor={`var(${colorVar})`} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((t) => (
          <line key={t} className="chart__grid" x1={PAD.left} x2={W - PAD.right} y1={PAD.top + (H - PAD.top - PAD.bottom) * t} y2={PAD.top + (H - PAD.top - PAD.bottom) * t} />
        ))}
        <m.g initial={reduced ? false : 'hidden'} whileInView="visible" viewport={VIEWPORT}>
          <m.path
            d={area}
            fill={`url(#${gradientId})`}
            variants={{ hidden: { opacity: 0 }, visible: { opacity: 1, transition: { duration: duration.slow, delay: duration.counter * 0.6 } } }}
          />
          <m.path
            d={line}
            fill="none"
            stroke={`var(${colorVar})`}
            strokeWidth={3}
            strokeLinecap="round"
            strokeLinejoin="round"
            variants={{ hidden: { pathLength: 0 }, visible: { pathLength: 1, transition: { duration: duration.counter * 1.2, ease: ease.standard } } }}
          />
          <m.circle
            cx={end[0]}
            cy={end[1]}
            r={6}
            fill={`var(${colorVar})`}
            stroke="var(--color-surface)"
            strokeWidth={3}
            style={{ transformBox: 'fill-box', originX: 0.5, originY: 0.5 }}
            variants={{ hidden: { scale: 0 }, visible: { scale: 1, transition: { duration: duration.base, ease: ease.emphasized, delay: duration.counter * 1.1 } } }}
          />
        </m.g>
        {data.map((d, i) =>
          i % 2 === 0 || i === data.length - 1 ? (
            <text key={d.label} className="chart__axis" x={PAD.left + step * i} y={H - 8} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'}>
              {d.label}
            </text>
          ) : null,
        )}
        <text className="chart__label" x={end[0] - 10} y={end[1] - 14} textAnchor="end">
          {formatNumber(data[data.length - 1]?.value ?? 0)}
        </text>
      </svg>
      <figcaption>{summary}</figcaption>
      <DataTableAlt caption={summary} data={data} unit={unit} />
    </figure>
  );
}
