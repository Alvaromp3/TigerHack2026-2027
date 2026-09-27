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

export function Kpi({ label, value, unit, note, tone, spark, sparkColor, sparkLabel }) {
  return (
    <article className={tone ? `kpi is-${tone}` : "kpi"}>
      <span className="kpi-label">{label}</span>
      <div className="kpi-value">
        <strong>{value}</strong>
        {unit && <small>{unit}</small>}
      </div>
      {note && <span className="kpi-note">{note}</span>}
      {spark && <Sparkline values={spark} color={sparkColor} label={sparkLabel || label} />}
    </article>
  );
}

export function Card({ title, kicker, action, className = "", children, demo }) {
  return (
    <section className={`card ${className}`} data-demo={demo}>
      {(title || kicker || action) && (
        <header className="card-head">
          <div>
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
