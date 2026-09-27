import { ESI, UNIT_ORDER, blockingUnit, countdown, tightestUnit } from "./network/ems";
import { Card, Kpi, PageHead } from "./ui";

function greeting(now) {
  const hour = now.getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function BriefingLines({ text }) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-*•]\s*/, "").replace(/\*\*/g, "").trim())
    .filter(Boolean);
  return (
    <ol className="brief-lines">
      {lines.map((line, index) => (
        <li key={index} style={{ animationDelay: `${index * 0.08}s` }}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <p>{line}</p>
        </li>
      ))}
    </ol>
  );
}

function dueSoon(incoming) {
  return incoming.filter((run) => run.status === "arrived" || (run.eta_seconds ?? 9999) <= 900);
}

function arrivalRank(run) {
  if (run.status === "pending") return 0;
  if (run.status === "arrived") return 1;
  return 2;
}

function netLabel(totals) {
  if (!totals) return null;
  const net = totals.admit - totals.discharge - totals.transfer;
  if (net > 0) return `+${net} net · filling over 2 h`;
  if (net < 0) return `${net} net · emptying over 2 h`;
  return "balanced over 2 h";
}

export default function OverviewTab({
  now,
  insights,
  briefing,
  onRefreshBriefing,
  capacity,
  incoming = [],
  emsStatus,
  onOpenAmbulances,
  onOpenRun,
}) {
  const totals = insights?.totals;
  const units = capacity?.units;
  const tight = tightestUnit(units);
  const blocker = blockingUnit(units);
  const pending = incoming.filter((run) => run.status === "pending");
  const soon = dueSoon(incoming).sort(
    (a, b) => arrivalRank(a) - arrivalRank(b) || (a.eta_seconds ?? 0) - (b.eta_seconds ?? 0),
  );
  const diverting = emsStatus?.ems_status === "diverting";
  const flow = netLabel(totals);
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const edOpen = units?.ed?.open;

  return (
    <div className="page">
      <PageHead
        kicker={dateLabel}
        title={`${greeting(now)}. Can we take the next ambulance?`}
        sub="Live capacity in every unit, who is due in 15 minutes, and the one decision that keeps the doors honest."
      >
        <div className={diverting ? "ov-head-status is-diverting" : "ov-head-status"}>
          <i />
          <strong>{diverting ? "On diversion" : "Accepting ambulances"}</strong>
          <small>
            {diverting
              ? emsStatus?.reason || "At capacity"
              : "What every ambulance company sees"}
          </small>
        </div>
      </PageHead>

      <div className="ov-hero">
        <section className="brief">
          <div className="brief-glow" aria-hidden="true" />
          <header>
            <span className="brief-mark" aria-hidden="true">
              <svg viewBox="0 0 20 20" fill="none"><path d="M10 2.5 11.8 8.2 17.5 10l-5.7 1.8L10 17.5l-1.8-5.7L2.5 10l5.7-1.8L10 2.5Z" fill="currentColor" /></svg>
            </span>
            <div>
              <strong>Hourly briefing</strong>
              <small>
                {briefing.loading
                  ? "Reading the census…"
                  : briefing.source === "ai"
                    ? "Written by Gemini from live data"
                    : "Computed from live data"}
              </small>
            </div>
            <button type="button" onClick={onRefreshBriefing} disabled={briefing.loading} aria-label="Refresh briefing">
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className={briefing.loading ? "is-spin" : ""}>
                <path d="M16.5 10a6.5 6.5 0 1 1-2-4.7M16.5 3.5v3.3h-3.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </header>
          <BriefingLines text={briefing.text} />
        </section>

        <section className="capacity">
          <p className="card-kicker">Unit capacity</p>
          {units ? (
            <ul className="unit-cap">
              {UNIT_ORDER.map((key) => {
                const unit = units[key];
                if (!unit) return null;
                return (
                  <li key={key} className={`is-${unit.level}`}>
                    <span>{unit.label}</span>
                    <div className="hunit-bar"><i style={{ width: `${unit.occupancy_pct}%` }} /></div>
                    <b>{unit.occupancy_pct}%</b>
                    <small>
                      {unit.open} open
                      {key === "ed" && capacity.ed_wait_min != null ? ` · ~${capacity.ed_wait_min} min wait` : ""}
                    </small>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="empty-note">Reading live capacity…</p>
          )}
          {flow && (
            <p className="cap-foot">
              <span>{flow}</span>
            </p>
          )}
        </section>
      </div>

      <div className="kpi-row">
        <Kpi
          label="Unanswered pre-alerts"
          icon="alert"
          value={pending.length}
          note={pending.length ? "waiting for an answer" : "every pre-alert answered"}
          tone={pending.length ? "warn" : undefined}
        />
        <Kpi
          label="Due in 15 min"
          icon="transfer"
          value={soon.length}
          note={soon.some((run) => run.status === "arrived") ? "includes the EMS bay" : "on the way to this door"}
        />
        <Kpi
          label="ED beds open"
          icon="bed"
          loading={!units}
          value={edOpen ?? "—"}
          note="held beds are not counted"
        />
        <Kpi
          label="Tightest unit"
          icon="bars"
          loading={!tight}
          value={tight ? tight.label : "—"}
          note={tight ? `${tight.open} open · ${tight.occupancy_pct}%` : ""}
          tone={tight && (tight.level === "full" || tight.level === "limited") ? "warn" : undefined}
        />
      </div>

      <Card
        kicker="Next 15 minutes"
        title={soon.length === 1 ? "1 ambulance arriving" : soon.length ? `${soon.length} ambulances arriving` : "No ambulance due"}
        icon="transfer"
        action={<button type="button" className="link-btn" onClick={onOpenAmbulances}>Ambulances →</button>}
      >
        <ul className="arrivals">
          {soon.map((run) => (
            <li
              key={run.id}
              className={run.status === "pending" ? "is-pending" : ""}
              style={{ "--esi": ESI[run.esi]?.color, "--esi-soft": ESI[run.esi]?.soft }}
            >
              <span className="esi-badge">ESI {run.esi}</span>
              <span className="arr-main">
                <strong>{run.complaint_label}</strong>
                <small>{run.unit}</small>
              </span>
              <span className="arr-needs">{(run.needs || []).join(" · ") || "ED bed"}</span>
              <em className="arr-bed">{run.bed_id ? run.bed_id : "no bed"}</em>
              <b className="arr-when">{run.status === "arrived" ? "at bay" : countdown(run.eta_seconds)}</b>
              {run.status === "pending" ? (
                <button type="button" className="dark-btn" onClick={() => onOpenRun(run)}>Answer</button>
              ) : (
                <span className="arr-gap" />
              )}
            </li>
          ))}
          {!soon.length && <li className="empty-note">Pre-alerts from ambulance crews appear here as soon as they are sent.</li>}
        </ul>
      </Card>

      {!diverting && blocker && (
        <p className="ov-block">
          {blocker.label} is {blocker.level === "full" ? "full" : "limited"} · {blocker.open} open.
          Ambulance companies still see Tiger Memorial as accepting. Diversion is in the bar above.
        </p>
      )}
    </div>
  );
}
