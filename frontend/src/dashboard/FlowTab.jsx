import { FlowChart, HBars, Legend, SERIES } from "./charts";
import { flowBucket } from "./flowBuckets";
import { Card, Kpi, PageHead, minutesText } from "./ui";

const FEED_KINDS = {
  admit: { label: "Admitted", tone: "admit" },
  discharge: { label: "Discharged", tone: "discharge" },
  divert: { label: "Transferred", tone: "transfer" },
  move: { label: "Moved", tone: "move" },
  or: { label: "Surgery", tone: "move" },
  turnover: { label: "Bed ready", tone: "ready" },
};

function ago(iso, now) {
  const stamp = new Date(iso);
  if (Number.isNaN(stamp.getTime())) return "";
  const seconds = Math.max(0, Math.round((now - stamp.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} min ago` : `${Math.round(minutes / 60)} h ago`;
}

export default function FlowTab({ insights, movements, deptLabels, now, onOpenRoom }) {
  const totals = insights?.totals || { admit: 0, discharge: 0, transfer: 0 };
  const net = totals.admit - totals.discharge - totals.transfer;
  const los = (insights?.los || []).map((row) => ({
    label: deptLabels[row.dept] || row.dept,
    value: row.avg_minutes,
    dept: row.dept,
  }));
  const feed = (movements || [])
    .map((event) => ({ ...event, bucket: flowBucket(event) }))
    // Executive feed: patient movements only, no clinical outcomes or command notes.
    .filter((event) => FEED_KINDS[event.bucket] && event.patient_name !== "Command")
    .slice(0, 14);

  return (
    <div className="page">
      <PageHead
        kicker="Patient flow"
        title="Are patients moving?"
        sub="If more patients come in than leave, the hospital fills up. This is the balance over the last two hours."
      >
        <span className={net > 0 ? "net-pill is-up" : net < 0 ? "net-pill is-down" : "net-pill"}>
          {net > 0 ? `+${net} net · filling` : net < 0 ? `${net} net · emptying` : "Balanced"}
        </span>
      </PageHead>

      <div className="kpi-row">
        <Kpi label="Admitted" value={totals.admit} note="last 2 hours" tone="admit" />
        <Kpi label="Discharged" value={totals.discharge} note="last 2 hours" tone="discharge" />
        <Kpi label="Transferred out" value={totals.transfer} note="to partner hospitals" />
        <Kpi
          label="Bed turnover"
          value={minutesText(insights?.turnover?.avg_minutes)}
          unit="min"
          note={insights?.turnover?.median_minutes != null ? `median ${minutesText(insights.turnover.median_minutes)} min` : "discharge → bed ready"}
        />
      </div>

      <Card
        kicker="Every 10 minutes"
        title="Admissions vs discharges"
        className="chart-card"
        demo="flowchart"
        action={<Legend items={[SERIES.admit, SERIES.discharge]} />}
      >
        {insights ? <FlowChart series={insights.series} /> : <p className="empty-note">Loading the last two hours…</p>}
      </Card>

      <div className="flow-grid">
        <Card kicker="Length of stay" title="Average time in bed by unit">
          {los.length ? (
            <HBars rows={los} format={(value) => `${minutesText(value)} min`} />
          ) : (
            <p className="empty-note">No patients in house.</p>
          )}
          <p className="card-foot">Simulation time: one tick is nine seconds.</p>
        </Card>

        <Card kicker="Longest stays" title="Ready for a discharge review?">
          <ul className="stay-list">
            {(insights?.longest || []).map((row) => (
              <li key={row.room_id}>
                <button type="button" onClick={() => onOpenRoom(row.room_id)}>
                  <span className="stay-room">{row.room_id}</span>
                  <span className="stay-who">
                    <strong>{row.patient}</strong>
                    <small>{row.diagnosis || deptLabels[row.dept] || row.dept}</small>
                  </span>
                  <b>{minutesText(row.minutes)} min</b>
                </button>
              </li>
            ))}
            {!insights?.longest?.length && <li className="empty-note">No patients in house.</li>}
          </ul>
        </Card>

        <Card kicker="Live feed" title="Latest movements">
          <ul className="feed">
            {feed.map((event) => (
              <li key={event.id} className={`is-${FEED_KINDS[event.bucket].tone}`}>
                <i />
                <div>
                  <strong>{event.message}</strong>
                  <small>{FEED_KINDS[event.bucket].label} · {ago(event.created_at, now)}</small>
                </div>
                {event.room_id && (
                  <button type="button" className="ghost-btn" onClick={() => onOpenRoom(event.room_id)}>View</button>
                )}
              </li>
            ))}
            {feed.length === 0 && <li className="empty-note">Waiting for the first movement…</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
