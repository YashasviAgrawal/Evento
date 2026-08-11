'use client';

import { useId, useMemo } from 'react';
import { formatMoney, formatShortDate } from '@/lib/format';

/**
 * Hand-rolled SVG charts.
 *
 * A charting library would add ~100KB and a React-19 peer-dependency conflict
 * for what amounts to two shapes. These render server-side, scale with the
 * container, and carry a text summary for screen readers.
 */

export interface SeriesPoint {
  date: string;
  value: number;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return Math.ceil(value / magnitude) * magnitude;
}

export function AreaChart({
  data,
  height = 220,
  format = (value: number) => String(value),
  label,
}: {
  data: SeriesPoint[];
  height?: number;
  format?: (value: number) => string;
  label: string;
}) {
  const gradientId = useId();
  const width = 720;
  const padding = { top: 16, right: 12, bottom: 28, left: 52 };

  const { path, areaPath, max, points } = useMemo(() => {
    if (data.length === 0) return { path: '', areaPath: '', max: 1, points: [] as Array<{ x: number; y: number; point: SeriesPoint }> };

    const max = niceMax(Math.max(...data.map((entry) => entry.value)));
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const step = data.length > 1 ? innerWidth / (data.length - 1) : 0;

    const points = data.map((point, index) => ({
      x: padding.left + index * step,
      y: padding.top + innerHeight - (point.value / max) * innerHeight,
      point,
    }));

    const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPath = `${path} L${points[points.length - 1]!.x.toFixed(1)},${padding.top + innerHeight} L${points[0]!.x.toFixed(1)},${padding.top + innerHeight} Z`;

    return { path, areaPath, max, points };
  }, [data, height, padding.bottom, padding.left, padding.right, padding.top]);

  if (data.length === 0) {
    return <div className="grid h-48 place-items-center text-sm text-ink-400">No data for this period</div>;
  }

  const gridLines = [0, 0.25, 0.5, 0.75, 1];
  const innerHeight = height - padding.top - padding.bottom;
  const total = data.reduce((sum, point) => sum + point.value, 0);

  return (
    <figure>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={`${label}. Total ${format(total)} across ${data.length} days.`}
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e11d48" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#e11d48" stopOpacity="0" />
          </linearGradient>
        </defs>

        {gridLines.map((ratio) => {
          const y = padding.top + innerHeight * ratio;
          return (
            <g key={ratio}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#e2e8f0" strokeWidth="1" />
              <text x={padding.left - 8} y={y + 4} textAnchor="end" className="fill-ink-400 text-[10px]">
                {format(Math.round(max * (1 - ratio)))}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill={`url(#${gradientId})`} />
        <path d={path} fill="none" stroke="#e11d48" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

        {points.map((p, index) => (
          <circle key={index} cx={p.x} cy={p.y} r="2.5" fill="#e11d48" opacity={index === points.length - 1 ? 1 : 0}>
            <title>{`${formatShortDate(p.point.date)}: ${format(p.point.value)}`}</title>
          </circle>
        ))}

        {/* Only label a handful of x ticks so they never collide. */}
        {points
          .filter((_, index) => index % Math.max(1, Math.ceil(points.length / 7)) === 0)
          .map((p, index) => (
            <text key={index} x={p.x} y={height - 8} textAnchor="middle" className="fill-ink-400 text-[10px]">
              {formatShortDate(p.point.date)}
            </text>
          ))}
      </svg>
    </figure>
  );
}

export function BarList({
  items,
  format = (value: number) => String(value),
}: {
  items: Array<{ label: string; value: number; color?: string }>;
  format?: (value: number) => string;
}) {
  const max = Math.max(1, ...items.map((item) => item.value));

  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-400">Nothing to show yet</p>;
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item.label}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-medium text-ink-800">{item.label}</span>
            <span className="shrink-0 tabular-nums text-ink-600">{format(item.value)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-100">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.max(2, (item.value / max) * 100)}%`,
                backgroundColor: item.color ?? '#e11d48',
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function RevenueChart({
  data,
  label = 'Revenue over time',
}: {
  data: Array<{ date: string; value: number }>;
  label?: string;
}) {
  return <AreaChart data={data} label={label} format={(value) => formatMoney(value, { compact: true })} />;
}
