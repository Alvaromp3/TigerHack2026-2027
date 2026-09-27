import { BED_MIX, Legend, MixBar, SERIES } from "./charts";
import { ESI, UNIT_ORDER, countdown } from "./network/ems";
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

export default function OverviewTab({
  now,
  mix,
  floors,
  outlook,
  insights,
  briefing,
  actions,
  busy,
  onRefreshBriefing,
  onOpenFloor,
  onOpenRoom,
  onRunAction,
  onOpenTab,
  capacity,
  incoming = [],
  emsSummary,
  emsStatus,
  calledPhysicians = 0,
  onCallPhysicians,
  onOpenAmbulances,
}) {
  const totals = insights?.totals;
  const series = insights?.series || [];
  const admits = series.map((slot) => slot.admit);
  const discharges = series.map((slot) => slot.discharge);
  const soon = incoming.filter((run) => run.status === "arrived" || (run.eta_seconds ?? 9999) <= 900);
  const diverting = emsStatus?.ems_status === "diverting";
  const net = totals ? totals.admit - totals.discharge - totals.transfer : null;
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="page">
      <PageHead
        kicker={dateLabel}
        title={`${greeting(now)}. Here is Tiger Memorial.`}
        sub="Live capacity in every unit, the ambulances on their way, and the decisions that keep the doors open."
      />

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
          <p className="card-kicker">Hospital capacity</p>
          <div className="cap-top">
            <div className="cap-big">
              <strong>{mix.pct}<small>%</small></strong>
              <span>occupied · {mix.occupied} of {mix.total} beds</span>
            </div>
            <div className="cap-forecast">
              <span>Open beds</span>
              <b>{outlook.now}<em>→</em>{outlook.soon}</b>
              <small>now → next {outlook.horizon} min</small>
            </div>
          </div>
          {capacity ? (
            <ul className="unit-cap">
              {UNIT_ORDER.map((key) => {
                const unit = capacity.units[key];
                return (
                  <li key={key} className={`is-${unit.level}`}>
                    <span>{unit.label}</span>
                    <div className="hunit-bar"><i style={{ width: `${unit.occupancy_pct}%` }} /></div>
                    <b>{unit.occupancy_pct}%</b>
                    <small>{unit.open} open</small>
                  </li>
                );
              })}
            </ul>
          ) : (
            <>
              <MixBar mix={mix} total={mix.total} height={14} />
              <Legend items={BED_MIX.map((item) => ({ ...item, value: mix[item.id] }))} />
            </>
          )}
        </section>
      </div>

      <div className="kpi-row">
        <Kpi
          label="Ambulances en route"
          icon="transfer"
          loading={!emsSummary}
          value={emsSummary?.en_route ?? "—"}
          note={emsSummary?.pending ? `${emsSummary.pending} waiting for an answer` : "all pre-alerts answered"}
          tone={emsSummary?.pending ? "warn" : undefined}
        />
        <Kpi
          label="Admitted · 2 h"
          icon="in"
          loading={!insights}
          value={totals ? totals.admit : "—"}
          note={net == null ? "" : net > 0 ? `+${net} net · filling` : net < 0 ? `${net} net · emptying` : "balanced"}
          spark={admits}
          sparkColor={SERIES.admit.color}
        />
        <Kpi
          label="Discharged · 2 h"
          icon="out"
          loading={!insights}
          value={totals ? totals.discharge : "—"}
          note={totals?.transfer ? `${totals.transfer} transferred out` : "no transfers out"}
          spark={discharges}
          sparkColor={SERIES.discharge.color}
        />
        <Kpi
          label="Avg offload time"
          icon="clock"
          loading={!emsSummary}
          value={emsSummary?.offload_avg_seconds != null ? `${Math.floor(emsSummary.offload_avg_seconds / 60)}:${String(emsSummary.offload_avg_seconds % 60).padStart(2, "0")}` : "—"}
          note={`${emsSummary?.arrivals_24h ?? 0} arrivals · ${emsSummary?.diverted_24h ?? 0} diverted today`}
        />
      </div>

      <div className="ov-ems">
        <Card
          kicker="Next 15 minutes"
          title={soon.length ? `${soon.length} ambulances arriving` : "No ambulance due"}
          icon="transfer"
          action={<button type="button" className="link-btn" onClick={onOpenAmbulances}>Ambulances →</button>}
        >
          <ul className="arrivals">
            {soon.map((run) => (
              <li key={run.id} style={{ "--esi": ESI[run.esi]?.color, "--esi-soft": ESI[run.esi]?.soft }}>
                <span className="esi-badge">ESI {run.esi}</span>
                <strong>{run.complaint_label}</strong>
                <small>{run.unit}</small>
                <em>{run.status === "pending" ? "needs an answer" : run.bed_id ? `→ ${run.bed_id}` : "no bed yet"}</em>
                <b>{run.status === "arrived" ? "at bay" : countdown(run.eta_seconds)}</b>
              </li>
            ))}
            {!soon.length && <li className="empty-note">Pre-alerts from ambulance crews appear here as soon as they are sent.</li>}
          </ul>
        </Card>
        <Card kicker="Decisions" title="Keep the doors open" icon="phone" className="ov-decide">
          <div className={diverting ? "ov-status is-diverting" : "ov-status"}>
            <i />
            <div>
              <strong>{diverting ? "On ambulance diversion" : "Accepting ambulances"}</strong>
              <small>{diverting ? emsStatus?.reason || "At capacity" : "Visible to every ambulance company in the region"}</small>
            </div>
          </div>
          <button type="button" className="dark-btn ov-call" disabled={Boolean(busy) || calledPhysicians > 0} onClick={onCallPhysicians}>
            {calledPhysicians ? `✓ ${calledPhysicians} on-call physicians on duty` : busy === "call" ? "Calling…" : "Call in on-call physicians"}
          </button>
        </Card>
      </div>

      <div className="ov-grid">
        <Card kicker="Floors" title="Where the beds are" icon="layers" className="floors-card">
          <ul className="floor-list">
            {floors.map((row) => (
              <li key={row.id}>
                <button type="button" onClick={() => onOpenFloor(row.id)}>
                  <span className="fl-code">{row.code}</span>
                  <span className="fl-name">
                    <strong>{row.name}</strong>
                    <small>{row.open} open · {row.turnover} in turnover</small>
                  </span>
                  <span className="fl-bar"><MixBar mix={row} total={row.total} height={10} /></span>
                  <span className={row.pct >= 90 ? "fl-pct is-high" : "fl-pct"}>{row.pct}%</span>
                  <svg className="fl-go" viewBox="0 0 12 12" aria-hidden="true">
                    <path d="m4.5 2.5 3.5 3.5-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </Card>

        <Card
          kicker="Next best actions"
          icon="spark"
          title="Worth doing now"
          className="todo-card"
          action={<button type="button" className="link-btn" onClick={() => onOpenTab("ops")}>Operations →</button>}
        >
          {actions.length === 0 ? (
            <p className="empty-note">Nothing is blocking flow. New suggestions appear here the moment a bed or a team needs attention.</p>
          ) : (
            <ol className="todo">
              {actions.slice(0, 3).map((item, index) => (
                <li key={item.id} className={`is-${item.tone}`}>
                  <span className="todo-rank">{index + 1}</span>
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.detail}</span>
                    <div className="todo-foot">
                      <em>{item.gain}</em>
                      {item.roomId && <button type="button" className="ghost-btn" onClick={() => onOpenRoom(item.roomId)}>View</button>}
                      {item.run && (
                        <button type="button" className="dark-btn" disabled={Boolean(busy)} onClick={() => onRunAction(item)}>
                          {busy === item.id ? "Working…" : item.run.label}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}
