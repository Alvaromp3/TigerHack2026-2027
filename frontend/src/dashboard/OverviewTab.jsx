import { BED_MIX, Legend, MixBar, SERIES } from "./charts";
import { Card, Kpi, PageHead, minutesText } from "./ui";

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
  history,
  briefing,
  actions,
  busy,
  onRefreshBriefing,
  onOpenFloor,
  onOpenRoom,
  onRunAction,
  onOpenTab,
}) {
  const totals = insights?.totals;
  const series = insights?.series || [];
  const admits = series.map((slot) => slot.admit);
  const discharges = series.map((slot) => slot.discharge);
  const occupancy = history.map((point) => point.pct);
  const net = totals ? totals.admit - totals.discharge - totals.transfer : null;
  const dateLabel = now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  return (
    <div className="page">
      <PageHead
        kicker={dateLabel}
        title={`${greeting(now)}. Here is Tiger Memorial.`}
        sub="Every number on this page comes from the live census and refreshes every two seconds."
      />

      <div className="ov-hero">
        <section className="brief" data-demo="briefing">
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

        <section className="capacity" data-demo="capacity">
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
          <MixBar mix={mix} total={mix.total} height={14} />
          <Legend items={BED_MIX.map((item) => ({ ...item, value: mix[item.id] }))} />
        </section>
      </div>

      <div className="kpi-row">
        <Kpi
          label="Occupancy trend"
          value={`${mix.pct}%`}
          note={history.length > 1 ? `since you opened · ${history.length} readings` : "collecting readings"}
          spark={occupancy}
          sparkColor="var(--viz-occupied)"
        />
        <Kpi
          label="Admitted · 2 h"
          value={totals ? totals.admit : "—"}
          note={net == null ? "" : net > 0 ? `+${net} net · filling` : net < 0 ? `${net} net · emptying` : "balanced"}
          spark={admits}
          sparkColor={SERIES.admit.color}
        />
        <Kpi
          label="Discharged · 2 h"
          value={totals ? totals.discharge : "—"}
          note={totals?.transfer ? `${totals.transfer} transferred out` : "no transfers out"}
          spark={discharges}
          sparkColor={SERIES.discharge.color}
        />
        <Kpi
          label="Bed turnover"
          value={minutesText(insights?.turnover?.avg_minutes)}
          unit="min"
          note={insights?.turnover?.samples ? `average of ${insights.turnover.samples} beds` : "no beds turned yet"}
        />
      </div>

      <div className="ov-grid">
        <Card kicker="Floors" title="Where the beds are" className="floors-card" demo="floors">
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
