import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "../api/client";
import { earlyWarning } from "./insights";
import { ESI, clockTime, countdown, secondsUntil, useNow } from "./network/ems";
import { Card, Kpi, PageHead } from "./ui";

const STATUS_LABEL = {
  pending: "Awaiting answer",
  accepted: "Accepted · bed held",
  arrived: "At EMS bay",
  handed_off: "Handed off",
  diverted: "Diverted",
};

function EsiBadge({ esi, large }) {
  const meta = ESI[esi] || ESI[3];
  return (
    <span className={large ? "esi-badge is-large" : "esi-badge"} style={{ "--esi": meta.color, "--esi-soft": meta.soft }}>
      ESI {esi}
      {large && <small>{meta.label}</small>}
    </span>
  );
}

function offload(seconds) {
  if (seconds == null) return "—";
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function Timeline({ run }) {
  const steps = [
    { label: "Pre-alert sent", at: run.created_at },
    { label: run.status === "diverted" ? `Diverted to ${run.diverted_to}` : "Accepted", at: run.responded_at },
    { label: "Arrived at EMS bay", at: run.arrived_at },
    { label: "Handed off to bed", at: run.handed_off_at },
  ];
  return (
    <ol className="amb-timeline">
      {steps.map((step) => (
        <li key={step.label} className={step.at ? "is-done" : ""}>
          <i />
          <span>{step.label}</span>
          <b>{step.at ? clockTime(step.at) : "—"}</b>
        </li>
      ))}
    </ol>
  );
}

export default function AmbulancesTab({ runs, summary, beds, hospitals, busy, focusId, onAccept, onDivert, onHandoff, onOpenRoom }) {
  const now = useNow();
  const [selectedId, setSelectedId] = useState(null);
  const [bedChoice, setBedChoice] = useState("");
  const [divertTo, setDivertTo] = useState("");
  const [recent, setRecent] = useState([]);

  const queue = useMemo(
    () => runs.filter((run) => run.destination === "Tiger Memorial" && ["pending", "accepted", "arrived"].includes(run.status)),
    [runs],
  );
  const selected = queue.find((run) => run.id === selectedId) || queue[0] || null;
  const openBeds = useMemo(
    () => beds.filter((room) => room.dept === "ed" && room.status === "available").map((room) => room.id).sort(),
    [beds],
  );
  const partners = hospitals.filter((row) => row.name !== "Tiger Memorial");

  useEffect(() => {
    if (focusId != null) setSelectedId(focusId);
  }, [focusId]);

  useEffect(() => {
    setBedChoice(selected?.bed_id || "");
    setDivertTo("");
  }, [selected?.id, selected?.bed_id]);

  useEffect(() => {
    let stop = false;
    async function pull() {
      try {
        const res = await fetch(apiUrl("/api/ems/runs?active=false&limit=14"));
        if (res.ok && !stop) {
          const body = await res.json();
          setRecent(body.runs.filter((run) => ["handed_off", "diverted"].includes(run.status)).slice(0, 10));
        }
      } catch {
        // Recent arrivals are secondary; keep the queue usable.
      }
    }
    pull();
    const timer = setInterval(pull, 6000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  const warning = selected
    ? earlyWarning({
        heartRate: selected.vitals.heart_rate,
        systolic: selected.vitals.systolic,
        diastolic: selected.vitals.diastolic,
        spo2: selected.vitals.spo2,
        respiratoryRate: selected.vitals.respiratory_rate,
      })
    : null;
  const bedOptions = selected?.bed_id && !openBeds.includes(selected.bed_id) ? [selected.bed_id, ...openBeds] : openBeds;

  return (
    <div className="page">
      <PageHead
        kicker="Ambulances"
        title="Who is coming, and what do they need?"
        sub="Crews pre-alert the hospital from the road. Accept and a bed is held on the live map before the doors open."
      />

      <div className="kpi-row">
        <Kpi icon="transfer" label="En route" value={summary?.en_route ?? "—"} note={`${summary?.pending ?? 0} waiting for an answer`} tone={summary?.pending ? "warn" : undefined} loading={!summary} />
        <Kpi icon="clock" label="Arriving < 10 min" value={summary?.arriving_10 ?? "—"} note={`${summary?.at_bay ?? 0} at the EMS bay now`} loading={!summary} />
        <Kpi icon="in" label="Avg offload time" value={summary?.offload_avg_seconds != null ? offload(summary.offload_avg_seconds) : "—"} note="arrival → patient in a bed" loading={!summary} />
        <Kpi icon="out" label="Diverted · 24 h" value={summary?.diverted_24h ?? "—"} note={`${summary?.arrivals_24h ?? 0} arrivals handed off`} loading={!summary} />
      </div>

      <div className="amb-grid">
        <section className="card amb-queue">
          <header className="card-head">
            <div className="card-titles">
              <p className="card-kicker">Incoming</p>
              <h2>{queue.length ? `${queue.length} ambulances` : "No ambulance on the way"}</h2>
            </div>
          </header>
          <ul>
            {queue.map((run) => {
              const left = secondsUntil(run.eta_at, now);
              return (
                <li key={run.id}>
                  <button
                    type="button"
                    className={`amb-row is-${run.status}${selected?.id === run.id ? " is-on" : ""}`}
                    style={{ "--esi": ESI[run.esi]?.color }}
                    onClick={() => setSelectedId(run.id)}
                  >
                    <EsiBadge esi={run.esi} />
                    <span className="amb-row-main">
                      <strong>{run.complaint_label}</strong>
                      <small>{run.unit} · {run.agency}</small>
                    </span>
                    <span className="amb-row-eta">
                      <b>{run.status === "arrived" ? "Here" : countdown(left)}</b>
                      <small>{STATUS_LABEL[run.status]}</small>
                    </span>
                  </button>
                </li>
              );
            })}
            {!queue.length && <li className="empty-note">New pre-alerts appear here with a chime.</li>}
          </ul>
        </section>

        <section className="card amb-detail">
          {selected ? (
            <>
              <header className="amb-detail-head" style={{ "--esi": ESI[selected.esi]?.color, "--esi-soft": ESI[selected.esi]?.soft }}>
                <EsiBadge esi={selected.esi} large />
                <div>
                  <p className="card-kicker">{selected.code} · {selected.unit} · {selected.agency}</p>
                  <h2>{selected.complaint_label}</h2>
                  <span>{selected.summary}</span>
                </div>
                <div className="amb-eta">
                  <b>{selected.status === "arrived" ? "At bay" : countdown(secondsUntil(selected.eta_at, now))}</b>
                  <small>{selected.status === "arrived" ? `for ${offload(Math.round((now - new Date(selected.arrived_at).getTime()) / 1000))}` : `ETA ${clockTime(selected.eta_at)} · from ${selected.zone}`}</small>
                </div>
              </header>

              <div className="amb-sections">
                <div>
                  <p className="card-kicker">Patient · field vitals</p>
                  <p className="amb-patient">{selected.patient_name}{selected.age ? `, ${selected.age}` : ""}</p>
                  {warning && (
                    <div className="rc-vitals">
                      {warning.rows.map((row) => (
                        <div key={row.label} className={`rc-vital s${row.score}`}>
                          <span>{row.label}</span>
                          <strong>{row.value}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                  {warning && <p className={`amb-news is-${warning.level}`}>NEWS {warning.total} · {warning.advice}</p>}
                </div>
                <div>
                  <p className="card-kicker">Needs on arrival</p>
                  <div className="amb-needs">
                    {selected.needs.map((need) => <span key={need}>{need}</span>)}
                  </div>
                  <Timeline run={selected} />
                </div>
              </div>

              <footer className="amb-actions">
                {selected.status === "pending" && (
                  <>
                    <label className="amb-field">
                      <span>Bed</span>
                      <select value={bedChoice} onChange={(event) => setBedChoice(event.target.value)}>
                        {!bedOptions.length && <option value="">No open ED bed</option>}
                        {bedOptions.map((id) => (
                          <option key={id} value={id}>{id}{id === selected.bed_id ? " · suggested" : ""}</option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="amb-accept" disabled={Boolean(busy) || !bedOptions.length} onClick={() => onAccept(selected, bedChoice || null)}>
                      {busy === `accept:${selected.id}` ? "Holding bed…" : `Accept & hold ${bedChoice || "bed"}`}
                    </button>
                  </>
                )}
                {selected.status === "accepted" && (
                  <button type="button" className="amb-accept is-ghost" onClick={() => onOpenRoom(selected.bed_id)}>
                    Bed {selected.bed_id} is held · show on map
                  </button>
                )}
                {selected.status === "arrived" && (
                  <button type="button" className="amb-accept" disabled={Boolean(busy)} onClick={() => onHandoff(selected)}>
                    {busy === `handoff:${selected.id}` ? "Moving patient…" : `Handoff complete → ${selected.bed_id}`}
                  </button>
                )}
                {selected.status !== "arrived" && (
                  <div className="amb-divert">
                    <select value={divertTo} onChange={(event) => setDivertTo(event.target.value)} aria-label="Divert to">
                      <option value="">Best partner hospital</option>
                      {partners.map((row) => (
                        <option key={row.name} value={row.name}>
                          {row.name} · {row.ems_status === "diverting" ? "diverting" : `${row.units.ed.open} ED open`}
                        </option>
                      ))}
                    </select>
                    <button type="button" className="amb-divert-btn" disabled={Boolean(busy)} onClick={() => onDivert(selected, divertTo || null)}>
                      {busy === `divert:${selected.id}` ? "Diverting…" : "Divert"}
                    </button>
                  </div>
                )}
              </footer>
            </>
          ) : (
            <div className="amb-empty">
              <strong>All quiet on the road.</strong>
              <span>When a crew sends a pre-alert you will hear a chime and see it here, with a bed already suggested.</span>
            </div>
          )}
        </section>
      </div>

      <Card kicker="Today" title="Recent arrivals and diversions" icon="list">
        <table className="amb-table">
          <thead>
            <tr><th>Run</th><th>ESI</th><th>Complaint</th><th>Outcome</th><th>Offload</th><th>Decided by</th></tr>
          </thead>
          <tbody>
            {recent.map((run) => (
              <tr key={run.id}>
                <td className="mono">{run.code}</td>
                <td><EsiBadge esi={run.esi} /></td>
                <td>{run.complaint_label}</td>
                <td>{run.status === "diverted" ? `Diverted → ${run.diverted_to}` : `In ${run.bed_id}`}</td>
                <td>{run.status === "handed_off" ? offload(run.offload_seconds) : "—"}</td>
                <td>{run.decided_by || "—"}</td>
              </tr>
            ))}
            {!recent.length && <tr><td colSpan={6} className="empty-note">No completed runs yet today.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
