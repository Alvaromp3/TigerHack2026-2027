import { useLayoutEffect, useRef, useState } from "react";

// Colors validated with the dataviz palette checker (see exec.css --viz-* tokens).
export const SERIES = {
  admit: { label: "Admitted", color: "var(--viz-admit)" },
  discharge: { label: "Discharged", color: "var(--viz-discharge)" },
};

export const BED_MIX = [
  // Order matters: blue and violet must never touch (they merge under deuteranopia).
  { id: "occupied", label: "Occupied", color: "var(--viz-occupied)" },
  { id: "open", label: "Open", color: "var(--viz-open)" },
  { id: "turnover", label: "Turnover", color: "var(--viz-turnover)" },
];

export function Sparkline({ values, color = "var(--viz-admit)", height = 36, label }) {
  const [hover, setHover] = useState(null);
  if (!values || values.length < 2) {
    return <div className="spark is-empty" style={{ height }} aria-hidden="true" />;
  }
  const width = 120;
  const max = Math.max(1, ...values);
  const min = Math.min(0, ...values);
  const x = (index) => (index / (values.length - 1)) * (width - 8) + 4;
  const y = (value) => height - 5 - ((value - min) / (max - min || 1)) * (height - 10);
  const line = values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)} ${y(value).toFixed(1)}`).join(" ");
  const area = `${line} L${x(values.length - 1)} ${height} L${x(0)} ${height} Z`;
  const point = hover == null ? values.length - 1 : hover;
  return (
    <div className="spark" style={{ height }}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
        onMouseMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          const ratio = (event.clientX - rect.left) / rect.width;
          setHover(Math.max(0, Math.min(values.length - 1, Math.round(ratio * (values.length - 1)))));
        }}
        onMouseLeave={() => setHover(null)}
      >
        <path d={area} fill={color} opacity="0.1" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      </svg>
      <i
        className="spark-dot"
        style={{ left: `${(x(point) / width) * 100}%`, top: `${(y(values[point]) / height) * 100}%`, background: color }}
      />
      {hover != null && <b className="spark-tip" style={{ left: `${(x(point) / width) * 100}%` }}>{values[point]}</b>}
    </div>
  );
}

// One stacked bar: occupied | open | turnover, with 2px surface gaps between segments.
export function MixBar({ mix, total, height = 12 }) {
  const parts = BED_MIX.filter((item) => mix[item.id] > 0);
  return (
    <div className="mixbar" style={{ height }} role="img" aria-label={BED_MIX.map((item) => `${mix[item.id]} ${item.label}`).join(", ")}>
      {parts.map((item) => (
        <i
          key={item.id}
          style={{ flexGrow: mix[item.id], background: item.color }}
          title={`${item.label}: ${mix[item.id]} of ${total}`}
        />
      ))}
    </div>
  );
}

export function Legend({ items }) {
  return (
    <ul className="legend-row">
      {items.map((item) => (
        <li key={item.label}>
          <i style={{ background: item.color }} />
          {item.label}
          {item.value != null && <b>{item.value}</b>}
        </li>
      ))}
    </ul>
  );
}

function niceMax(value) {
  if (value <= 4) return 4;
  const step = value <= 10 ? 2 : value <= 20 ? 5 : 10;
  return Math.ceil(value / step) * step;
}

function timeLabel(iso) {
  const stamp = new Date(iso);
  return Number.isNaN(stamp.getTime()) ? "" : stamp.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// Paired columns per time bucket: admitted vs discharged. One y-axis, hover tooltip per bucket.
export function FlowChart({ series }) {
  const [hover, setHover] = useState(null);
  const boxRef = useRef(null);
  const [width, setWidth] = useState(720);
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return undefined;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(320, Math.round(entry.contentRect.width))));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  const height = 260;
  const pad = { top: 16, right: 12, bottom: 28, left: 32 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...series.flatMap((slot) => [slot.admit, slot.discharge])));
  const band = innerW / Math.max(1, series.length);
  const bar = Math.max(4, Math.min(24, (band - 14) / 2));
  const y = (value) => pad.top + innerH - (value / max) * innerH;
  const ticks = [0, max / 2, max];

  function column(x, value, color) {
    if (!value) return null;
    const top = y(value);
    const h = pad.top + innerH - top;
    const r = Math.min(4, h, bar / 2);
    // 4px rounded data-end, square at the baseline.
    const d = `M${x} ${pad.top + innerH} V${top + r} Q${x} ${top} ${x + r} ${top} H${x + bar - r} Q${x + bar} ${top} ${x + bar} ${top + r} V${pad.top + innerH} Z`;
    return <path d={d} fill={color} />;
  }

  const active = hover == null ? null : series[hover];
  return (
    <div className="flowchart" ref={boxRef}>
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label="Admissions and discharges per 10 minutes">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={width - pad.right} y1={y(tick)} y2={y(tick)} className="fc-grid" />
            <text x={pad.left - 8} y={y(tick) + 4} textAnchor="end" className="fc-axis">{tick}</text>
          </g>
        ))}
        {series.map((slot, index) => {
          const left = pad.left + band * index + (band - (bar * 2 + 2)) / 2;
          return (
            <g key={slot.start}>
              {hover === index && (
                <rect x={pad.left + band * index} y={pad.top} width={band} height={innerH} className="fc-hover" />
              )}
              {column(left, slot.admit, SERIES.admit.color)}
              {column(left + bar + 2, slot.discharge, SERIES.discharge.color)}
              {(index % 2 === 0 || series.length <= 8) && (
                <text x={pad.left + band * index + band / 2} y={height - 8} textAnchor="middle" className="fc-axis">
                  {timeLabel(slot.start)}
                </text>
              )}
              <rect
                x={pad.left + band * index}
                y={pad.top}
                width={band}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(index)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          );
        })}
      </svg>
      {active && (
        <div className="fc-tip" style={{ left: `${((pad.left + band * hover + band / 2) / width) * 100}%` }}>
          <strong>{timeLabel(active.start)}</strong>
          <span><i style={{ background: SERIES.admit.color }} />Admitted <b>{active.admit}</b></span>
          <span><i style={{ background: SERIES.discharge.color }} />Discharged <b>{active.discharge}</b></span>
          {active.transfer > 0 && <span><i className="is-muted" />Transferred out <b>{active.transfer}</b></span>}
        </div>
      )}
    </div>
  );
}

// Horizontal bars, single series (one hue), value at the tip.
export function HBars({ rows, format = (value) => value, onPick }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="hbars">
      {rows.map((row) => (
        <li key={row.label}>
          <button type="button" onClick={onPick ? () => onPick(row) : undefined} disabled={!onPick}>
            <span className="hb-label">{row.label}</span>
            <span className="hb-track">
              <i style={{ width: `${Math.max(2, (row.value / max) * 100)}%` }} />
            </span>
            <b>{format(row.value)}</b>
          </button>
        </li>
      ))}
    </ul>
  );
}
