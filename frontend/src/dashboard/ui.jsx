import { Sparkline } from "./charts";

const OCCUPIED = new Set(["critical", "warning", "normal"]);

export function bedMix(beds) {
  const mix = { occupied: 0, open: 0, turnover: 0 };
  for (const bed of beds) {
    if (OCCUPIED.has(bed.status)) mix.occupied += 1;
    else if (bed.status === "available") mix.open += 1;
    else mix.turnover += 1;
  }
  const total = beds.length;
  return { ...mix, total, pct: total ? Math.round((mix.occupied / total) * 100) : 0 };
}

export function floorRows(hospital) {
  return hospital
    .map((level) => {
      const beds = level.rooms.filter((room) => room.census);
      return { id: level.id, code: level.code, name: level.subtitle || level.name, ...bedMix(beds) };
    })
    .filter((row) => row.total > 0);
}

export function minutesText(value) {
  if (value == null) return "—";
  if (value < 1) return "<1";
  return value < 10 ? value.toFixed(1) : String(Math.round(value));
}

// Plain-language fallback so the home screen always has a briefing, even with the AI offline.
export function localBriefing({ mix, floors, totals, turnover, actions }) {
  const fullest = [...floors].sort((a, b) => b.pct - a.pct)[0];
  const lines = [
    `Occupancy is ${mix.pct}% with ${mix.open} open beds${fullest ? `; ${fullest.name} is fullest at ${fullest.pct}%` : ""}.`,
  ];
  if (totals) {
    const net = totals.admit - totals.discharge - totals.transfer;
    lines.push(
      `Last 2 hours: ${totals.admit} admitted, ${totals.discharge} discharged${
        turnover?.avg_minutes != null ? `, beds turn over in ${minutesText(turnover.avg_minutes)} min` : ""
      } (${net > 0 ? `+${net} net, filling` : net < 0 ? `${net} net, emptying` : "balanced"}).`,
    );
  }
  lines.push(actions?.[0] ? `Suggested now: ${actions[0].title}.` : "No action needed right now.");
  return lines.map((line) => `- ${line}`).join("\n");
}

const GLYPHS = {
  bed: <><path d="M2.5 15.5v-8M2.5 12.5h15v3M17.5 12.5v-1.8a2.2 2.2 0 0 0-2.2-2.2H9v4" /><circle cx="5.6" cy="9.8" r="1.5" /></>,
  in: <><path d="M10 3v10M5.5 8.5 10 13l4.5-4.5" /><path d="M3.5 16.5h13" /></>,
  out: <><path d="M10 13V3M5.5 7.5 10 3l4.5 4.5" /><path d="M3.5 16.5h13" /></>,
  clock: <><circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.8 1.8" /></>,
  trend: <><path d="M3 14.5 7.5 10l3 3L17 6.5" /><path d="M12.5 6.5H17V11" /></>,
  users: <><circle cx="8" cy="7.4" r="2.7" /><path d="M3 17v-.7A3.6 3.6 0 0 1 6.6 12.7h2.8A3.6 3.6 0 0 1 13 16.3V17" /><path d="M14.4 5.3a2.6 2.6 0 0 1 0 5.1M18 17v-.6a3.4 3.4 0 0 0-2.5-3.3" /></>,
  alert: <><path d="M10 2.8 18 16.6H2L10 2.8Z" /><path d="M10 8.2v3.6M10 14.2h.01" /></>,
  broom: <><path d="M12.8 3.2 7.6 10.4" /><path d="M5 11.2c1.8-1.4 4.4-.9 5.6.9l-1.9 5.2H3.3l1.7-6.1Z" /></>,
  transfer: <><path d="M3 7h12.5M12 3.5 15.5 7 12 10.5" /><path d="M17 13H4.5M8 9.5 4.5 13 8 16.5" /></>,
  phone: <><path d="M5.2 3h2.6l1.4 3.6-1.8 1.2a8 8 0 0 0 4.8 4.8l1.2-1.8L17 12.2v2.6A2.2 2.2 0 0 1 14.8 17 11.8 11.8 0 0 1 3 5.2 2.2 2.2 0 0 1 5.2 3Z" /></>,
  layers: <><path d="M10 2.5 2.5 6 10 9.5 17.5 6 10 2.5Z" /><path d="M2.5 10 10 13.5 17.5 10M2.5 14 10 17.5 17.5 14" /></>,
  pause: <><circle cx="10" cy="10" r="7" /><path d="M8.2 7.5v5M11.8 7.5v5" /></>,
  wrench: <><path d="M12.6 3.2a3.8 3.8 0 0 0-4.4 5L3.5 12.9a1.8 1.8 0 0 0 2.6 2.6l4.7-4.7a3.8 3.8 0 0 0 5-4.4l-2.3 2.3-2.2-.6-.6-2.2 2.3-2.3Z" /></>,
  bars: <><path d="M3 17V3M3 17h14" /><path d="M6.6 17v-4M10.5 17V8M14.4 17v-6" /></>,
  list: <><path d="M7 5h10M7 10h10M7 15h10" /><circle cx="3.5" cy="5" r=".6" /><circle cx="3.5" cy="10" r=".6" /><circle cx="3.5" cy="15" r=".6" /></>,
  spark: <path d="M10 2.5 11.8 8.2 17.5 10l-5.7 1.8L10 17.5l-1.8-5.7L2.5 10l5.7-1.8L10 2.5Z" />,
};

export function Glyph({ name, className = "glyph" }) {
  return (
    <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[name]}
    </svg>
  );
}

export function PageHead({ kicker, title, sub, children }) {
  return (
    <header className="page-head">
      <div>
        <p className="page-kicker">{kicker}</p>
        <h1>{title}</h1>
        {sub && <p className="page-sub">{sub}</p>}
      </div>
      {children && <div className="page-tools">{children}</div>}
    </header>
  );
}

export function Kpi({ label, value, unit, note, tone, icon, loading, spark, sparkColor, sparkLabel }) {
  return (
    <article className={tone ? `kpi is-${tone}` : "kpi"}>
      <div className="kpi-top">
        <span className="kpi-label">{label}</span>
        {icon && <span className="kpi-icon"><Glyph name={icon} /></span>}
      </div>
      {loading ? (
        <div className="kpi-value"><span className="skeleton is-num" /></div>
      ) : (
        <div className="kpi-value">
          <strong>{value}</strong>
          {unit && <small>{unit}</small>}
        </div>
      )}
      {loading ? <span className="skeleton is-line" /> : note && <span className="kpi-note">{note}</span>}
      {spark && <Sparkline values={spark} color={sparkColor} label={sparkLabel || label} />}
    </article>
  );
}

export function Card({ title, kicker, icon, action, className = "", children }) {
  return (
    <section className={`card ${className}`}>
      {(title || kicker || action) && (
        <header className="card-head">
          {icon && <span className="card-icon"><Glyph name={icon} /></span>}
          <div className="card-titles">
            {kicker && <p className="card-kicker">{kicker}</p>}
            {title && <h2>{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function initialsOf(name) {
  const parts = String(name || "").replace(/^(Dr\.?|RN)\s+/i, "").trim().split(/\s+/);
  return parts.slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}
