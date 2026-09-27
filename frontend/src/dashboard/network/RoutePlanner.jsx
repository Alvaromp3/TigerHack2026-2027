import { useEffect, useState } from "react";
import { actorHeaders, apiUrl } from "../../api/client";
import { COMPLAINTS, ESI, ZONES } from "./ems";

// "Where should this ambulance go?" Ranks the region for one patient and sends the pre-alert.
export default function RoutePlanner({ canSend = true, onSent, onPick }) {
  const [esi, setEsi] = useState(2);
  const [complaint, setComplaint] = useState("stroke");
  const [zone, setZone] = useState("East");
  const [options, setOptions] = useState(null);
  const [sending, setSending] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    let stop = false;
    const params = new URLSearchParams({ esi: String(esi), complaint, zone });
    fetch(apiUrl(`/api/public/route?${params}`))
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!stop && body) {
          setOptions(body.options);
          onPick?.(body.options.find((row) => row.eligible)?.hospital || null);
        }
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
    // onPick is a parent callback; re-query only when the patient changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esi, complaint, zone]);

  async function send(destination) {
    setSending(destination);
    setNote("");
    try {
      const res = await fetch(apiUrl("/api/ems/runs"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...actorHeaders() },
        body: JSON.stringify({ esi, complaint, zone, destination }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof body.detail === "string" ? body.detail : "The pre-alert did not send.");
      setNote(`${body.code} sent to ${destination} · ETA ${Math.max(1, Math.round((body.eta_seconds || 0) / 60))} min`);
      onSent?.(body);
    } catch (error) {
      setNote(error.message);
    } finally {
      setSending("");
    }
  }

  return (
    <section className="planner">
      <header>
        <p className="card-kicker">Route a patient</p>
        <h2>Where should this ambulance go?</h2>
      </header>
      <div className="planner-field">
        <span>Triage (ESI)</span>
        <div className="esi-pick" role="group" aria-label="ESI level">
          {[1, 2, 3, 4, 5].map((level) => (
            <button
              key={level}
              type="button"
              className={esi === level ? "is-on" : ""}
              style={{ "--esi": ESI[level].color, "--esi-soft": ESI[level].soft }}
              onClick={() => setEsi(level)}
              title={ESI[level].label}
            >
              <b>{level}</b>
              <small>{ESI[level].label}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="planner-field">
        <span>Complaint</span>
        <div className="chip-pick">
          {COMPLAINTS.map((item) => (
            <button key={item.id} type="button" className={complaint === item.id ? "is-on" : ""} onClick={() => setComplaint(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="planner-field">
        <span>Pickup zone</span>
        <div className="chip-pick">
          {ZONES.map((name) => (
            <button key={name} type="button" className={zone === name ? "is-on" : ""} onClick={() => setZone(name)}>
              {name}
            </button>
          ))}
        </div>
      </div>

      <ol className="route-list">
        {(options || []).map((row, index) => (
          <li key={row.hospital} className={row.eligible ? "" : "is-out"}>
            <div className="route-head">
              <span className="route-rank">{row.eligible ? index + 1 : "✕"}</span>
              <div>
                <strong>{row.hospital}</strong>
                <small>{row.drive_minutes} min drive · {row.data === "live" ? "live capacity" : "emulated feed"}</small>
              </div>
              {canSend && row.eligible && (
                <button type="button" className="dark-btn" disabled={Boolean(sending)} onClick={() => send(row.hospital)}>
                  {sending === row.hospital ? "Sending…" : "Send pre-alert"}
                </button>
              )}
            </div>
            <ul className="route-why">
              {row.reasons.map((reason) => (
                <li key={reason.text} className={reason.ok ? "is-ok" : "is-no"}>{reason.ok ? "✓" : "✕"} {reason.text}</li>
              ))}
            </ul>
          </li>
        ))}
        {!options && <li className="route-empty">Asking the network…</li>}
      </ol>
      {note && <p className="planner-note">{note}</p>}
    </section>
  );
}
