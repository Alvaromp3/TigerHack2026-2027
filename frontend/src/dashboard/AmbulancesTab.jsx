import { useEffect, useMemo, useState } from "react";
import { apiUrl } from "../api/client";
import { earlyWarning } from "./insights";
import { ESI, clockTime, countdown, secondsUntil, useNow } from "./network/ems";
import { Card, EtaTrack, HeroStat, NO_ANSWER_LEAD_SECONDS, PageHero } from "./ui";

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

// Photo of the kind of bed being held, from /public/rooms.
function bedLook(id) {
  if (!id) return { src: "/rooms/resus.png", kind: "No bed chosen" };
  if (/^(ED|ER)-T/.test(id)) return { src: "/rooms/trauma.png", kind: "Trauma bay" };
  if (id.startsWith("FAST-")) return { src: "/rooms/triage.png", kind: "Fast track" };
  if (id.startsWith("OBS-")) return { src: "/rooms/medsurg.png", kind: "Observation" };
  return { src: "/rooms/ed-exam.png", kind: "Emergency exam room" };
}

function BedVisual({ id, label, empty }) {
  const look = bedLook(id);
  return (
    <div className="bed-visual">
      <img src={look.src} alt="" />
      <div>
        <small>{label}</small>
        <strong>{id || "—"}</strong>
        <span>{id ? look.kind : empty || look.kind}</span>
      </div>
    </div>
  );
}

function offload(seconds) {
  if (seconds == null) return "—";
  return seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, "0")}s`;
}

// Big number, small units, so it fits a hero tile: 1m 01s.
function OffloadValue({ seconds }) {
  const whole = Math.round(seconds);
  if (whole < 60) return <>{whole}<small>s</small></>;
  return <>{Math.floor(whole / 60)}<small>m</small> {String(whole % 60).padStart(2, "0")}<small>s</small></>;
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

export default function AmbulancesTab({ runs, summary, hospitals, busy, focusId, onAccept, onDivert, onHandoff, onOpenRoom }) {
  const now = useNow();
  const [selectedId, setSelectedId] = useState(null);
  const [bestPartner, setBestPartner] = useState(null);
  const [recent, setRecent] = useState([]);

  const queue = useMemo(
    () => runs.filter((run) => run.destination === "Tiger Memorial" && ["pending", "accepted", "arrived"].includes(run.status)),
    [runs],
  );
  const selected = queue.find((run) => run.id === selectedId) || queue[0] || null;
  const partnerRow = hospitals.find((row) => row.name === bestPartner) || null;

  useEffect(() => {
    if (focusId != null) setSelectedId(focusId);
  }, [focusId]);

  // Where a divert would send this crew: the same ranking the API uses, asked once per ambulance.
  useEffect(() => {
    setBestPartner(null);
    if (!selected || !["pending", "accepted"].includes(selected.status)) return undefined;
    let stop = false;
    const query = new URLSearchParams({ esi: selected.esi, complaint: selected.complaint, zone: selected.zone });
    fetch(apiUrl(`/api/public/route?${query}`))
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (stop || !body) return;
        const others = (body.options || []).filter((row) => row.hospital !== "Tiger Memorial");
        setBestPartner((others.find((row) => row.eligible) || others[0])?.hospital || null);
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
    // Re-rank only when a different ambulance is selected or its state changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id, selected?.status]);

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

  return (
    <div className="page has-hero amb2">
      <PageHero
        video="/videos/ambulance.mp4"
        poster="/videos/ambulance.jpg"
        position="center 62%"
        kicker="Ambulances"
        title="Who is coming, and what do they need?"
        sub="Crews pre-alert us from the road with triage and vitals. We answer, a bed is held on the live map, and the doors are ready when they arrive."
      >
        <div className="hero-stats">
          <HeroStat value={summary?.en_route ?? "—"} label="On the way" />
          <HeroStat value={summary?.pending ?? "—"} label="Waiting for our answer" tone={summary?.pending ? "alert" : undefined} />
          <HeroStat value={summary?.offload_avg_seconds != null ? <OffloadValue seconds={summary.offload_avg_seconds} /> : "—"} label="Avg offload time" />
          <HeroStat value={summary?.arrivals_24h ?? "—"} label="Arrivals today" />
        </div>
      </PageHero>

      <div className="amb-grid">
        <section className="card amb-queue">
          <header className="card-head">
            <div className="card-titles">
              <p className="card-kicker">Incoming · live</p>
              <h2>{queue.length ? `${queue.length} ambulances` : "No ambulance on the way"}</h2>
            </div>
            <span className="amb-live"><i />Live</span>
          </header>
          <ul>
            {queue.map((run) => {
              const left = secondsUntil(run.eta_at, now);
              return (
                <li key={run.id}>
                  <button
                    type="button"
                    className={`amb-row is-${run.status}${selected?.id === run.id ? " is-on" : ""}`}
                    style={{ "--esi": ESI[run.esi]?.color, "--esi-soft": ESI[run.esi]?.soft }}
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
                    <EtaTrack run={run} left={left} />
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
                  <p className="card-kicker">Patient · vitals from the ambulance</p>
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
                  <p className="card-kicker amb-needs-title">Needs on arrival</p>
                  <div className="amb-needs">
                    {selected.needs.map((need) => <span key={need}>{need}</span>)}
                  </div>
                </div>
                <div>
                  {selected.status === "arrived" ? (
                    <div className="bed-visual is-bay">
                      <img src="/rooms/ems.png" alt="" />
                      <div>
                        <small>Now</small>
                        <strong>At the EMS bay</strong>
                        <span>Bed {selected.bed_id} is waiting</span>
                      </div>
                    </div>
                  ) : (
                    <BedVisual
                      id={selected.bed_id}
                      label={
                        selected.status !== "pending"
                          ? "Bed held"
                          : selected.bed_id
                            ? "Free bed, picked automatically"
                            : "No suitable bed free"
                      }
                      empty="Divert, or free a bed on the live map"
                    />
                  )}
                  <Timeline run={selected} />
                </div>
              </div>

              {selected.status === "pending" && (
                <p className="amb-deadline">
                  <i aria-hidden="true" />
                  Nothing is accepted automatically. The crew waits for our answer for another{" "}
                  <b>{countdown(Math.max(0, secondsUntil(selected.eta_at, now) - NO_ANSWER_LEAD_SECONDS))}</b>, then takes
                  the patient to the next hospital.
                </p>
              )}
              <footer className="amb-actions">
                {selected.status === "pending" && (
                  // No bed is named: the API holds the free bed picked for this crew, or the next free one.
                  <button type="button" className="amb-accept" disabled={Boolean(busy) || !selected.bed_id} onClick={() => onAccept(selected, null)}>
                    {busy === `accept:${selected.id}`
                      ? "Holding bed…"
                      : selected.bed_id
                        ? `Accept · hold ${selected.bed_id}`
                        : "No free bed to hold"}
                  </button>
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
                    <button type="button" className="amb-divert-btn" disabled={Boolean(busy)} onClick={() => onDivert(selected, bestPartner)}>
                      {busy === `divert:${selected.id}`
                        ? "Diverting…"
                        : bestPartner
                          ? `Divert → ${bestPartner}`
                          : "Divert to the best partner"}
                    </button>
                    {partnerRow?.units?.ed && (
                      <small>
                        {partnerRow.ems_status === "diverting" ? "Also on diversion" : `${partnerRow.units.ed.open} ED beds open there`}
                      </small>
                    )}
                  </div>
                )}
              </footer>
            </>
          ) : (
            <div className="amb-empty">
              <img src="/rooms/ems.png" alt="" />
              <strong>All quiet on the road.</strong>
              <span>When a crew sends a pre-alert you will hear a chime and see it here, with a free bed already picked for them.</span>
            </div>
          )}
        </section>
      </div>

      <Card kicker="Today" title="Recent arrivals and diversions" icon="list" className="amb-recent">
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
                <td className={run.decided_by === "No answer" ? "amb-noanswer" : ""}>{run.decided_by === "auto" ? "Autopilot" : run.decided_by || "—"}</td>
              </tr>
            ))}
            {!recent.length && <tr><td colSpan={6} className="empty-note">No completed runs yet today.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
