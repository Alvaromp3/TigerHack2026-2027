import { useEffect, useMemo, useRef, useState } from "react";
import { FLOW_BUCKETS, flowBucket } from "./flowBuckets";

const PATIENT_BUCKETS = FLOW_BUCKETS.filter((bucket) => bucket.id !== "turnover");

function eventClock(iso) {
  if (!iso) return "--:--:--";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
}

function isPatientEvent(item) {
  const text = (item.message || "").toLowerCase();
  if (text.includes(" is open")) return false;
  if (text.includes("surge declared")) return false;
  return flowBucket(item.message) !== "turnover";
}

function kindFor(message) {
  const id = flowBucket(message);
  return PATIENT_BUCKETS.find((bucket) => bucket.id === id) || PATIENT_BUCKETS[1];
}

export default function PatientFlow({ movements, linked, onOpenMovement }) {
  const [filter, setFilter] = useState("all");
  const [freshId, setFreshId] = useState(null);
  const seen = useRef(null);

  const patients = useMemo(() => movements.filter(isPatientEvent), [movements]);

  useEffect(() => {
    const ids = new Set(movements.map((item) => item.id));
    if (seen.current == null) {
      seen.current = ids;
      return undefined;
    }
    const newest = movements.find((item) => !seen.current.has(item.id));
    seen.current = ids;
    if (!newest || !isPatientEvent(newest)) return undefined;
    setFreshId(newest.id);
    const timer = setTimeout(() => {
      setFreshId((current) => (current === newest.id ? null : current));
    }, 2800);
    return () => clearTimeout(timer);
  }, [movements]);

  const counts = useMemo(() => {
    const tally = { all: patients.length };
    for (const bucket of PATIENT_BUCKETS) tally[bucket.id] = 0;
    for (const item of patients) tally[flowBucket(item.message)] += 1;
    return tally;
  }, [patients]);

  const rows = filter === "all"
    ? patients
    : patients.filter((item) => flowBucket(item.message) === filter);

  return (
    <section className="flow-term" aria-label="Patient flow">
      <p className="flow-prompt">
        <span className="flow-host">flow@tiger-memorial</span>
        <span> ~ % tail -f patients</span>
        <span className={linked ? "flow-live is-on" : "flow-live"}>
          <i />
          {linked ? "Live" : "Hold"}
        </span>
      </p>

      <div className="flow-filters" role="tablist" aria-label="Movement type">
        <button
          type="button"
          role="tab"
          aria-selected={filter === "all"}
          className={filter === "all" ? "is-on" : ""}
          onClick={() => setFilter("all")}
        >
          All <b>{counts.all}</b>
        </button>
        {PATIENT_BUCKETS.map((bucket) => (
          <button
            key={bucket.id}
            type="button"
            role="tab"
            aria-selected={filter === bucket.id}
            className={filter === bucket.id ? `is-on tone-${bucket.id}` : `tone-${bucket.id}`}
            onClick={() => setFilter(bucket.id)}
          >
            {bucket.label} <b>{counts[bucket.id]}</b>
          </button>
        ))}
      </div>

      <div className="flow-log">
        {patients.length === 0 ? (
          <p className="flow-wait">
            <span className="flow-caret" aria-hidden="true" />
            waiting for patient movement
          </p>
        ) : rows.length === 0 ? (
          <p className="flow-wait">no matching movement</p>
        ) : (
          <ol>
            {rows.map((item) => {
              const kind = kindFor(item.message);
              const fresh = item.id === freshId;
              const line = (
                <>
                  <time dateTime={item.created_at || undefined}>{eventClock(item.created_at)}</time>
                  <em className="flow-kind">{kind.code}</em>
                  <span>{item.message}</span>
                  {fresh ? <span className="flow-caret" aria-hidden="true" /> : <span />}
                </>
              );
              return (
                <li key={item.id} className={fresh ? `flow-line is-fresh tone-${kind.id}` : `flow-line tone-${kind.id}`}>
                  {item.room_id ? (
                    <button type="button" className="flow-line-btn" onClick={() => onOpenMovement(item)}>
                      {line}
                    </button>
                  ) : (
                    <div className="flow-line-btn">{line}</div>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <footer className="flow-term-foot">
        <span>POLL 4s</span>
        <span className={linked ? "is-linked" : "is-stale"}>{linked ? "LINKED" : "STALE"}</span>
        <span>{rows.length} on screen</span>
      </footer>
    </section>
  );
}
