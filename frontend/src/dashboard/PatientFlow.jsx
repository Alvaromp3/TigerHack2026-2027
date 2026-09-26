import { useEffect, useMemo, useRef, useState } from "react";
import { FLOW_BUCKETS, flowBucket } from "./flowBuckets";

const PATIENT_BUCKETS = FLOW_BUCKETS.filter((bucket) => bucket.id !== "turnover");
const SHOWN_BUCKETS = ["admit", "or", "discharge", "death"];
const BURST_MIN = 3;

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
  return flowBucket(item) !== "turnover";
}

function kindFor(item) {
  const id = flowBucket(item);
  return PATIENT_BUCKETS.find((bucket) => bucket.id === id) || PATIENT_BUCKETS[1];
}

function isCritical(item) {
  const id = flowBucket(item);
  return id === "death" || id === "divert";
}

function sameName(item, name) {
  return (item.patient_name || "").trim().toLowerCase() === name.trim().toLowerCase();
}

function grepNeedle(query) {
  return query.trim().replace(/^\//, "").toLowerCase();
}

function matchesGrep(item, needle) {
  if (!needle) return true;
  const kind = kindFor(item);
  const hay = [item.patient_name, item.room_id, item.message, kind.code, kind.label]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return hay.includes(needle);
}

function splitMessage(item) {
  const name = (item.patient_name || "").trim();
  const message = item.message || "";
  if (name && message.toLowerCase().startsWith(name.toLowerCase())) {
    return { name, rest: message.slice(name.length).trimStart() };
  }
  return { name, rest: message.trim() };
}

function lineText(item) {
  return `${eventClock(item.created_at)}  ${kindFor(item).code}  ${item.message || ""}`;
}

function roomCluster(roomId) {
  if (!roomId) return null;
  const match = String(roomId).match(/^([A-Za-z]+)[-\s]?(\d)/);
  if (!match) return String(roomId);
  const more = /\d{2,}/.test(String(roomId));
  return more ? `${match[1].toUpperCase()} ${match[2]}xx` : match[1].toUpperCase();
}

function deathWatch(events, now) {
  const deaths = events.filter((item) => flowBucket(item) === "death" && item.created_at);
  if (deaths.length < BURST_MIN) return null;
  const times = deaths
    .map((item) => new Date(item.created_at).getTime())
    .filter((time) => Number.isFinite(time));
  if (!times.length) return null;
  const minutes = Math.max(1, Math.round((now - Math.min(...times)) / 60000));
  const tally = new Map();
  for (const item of deaths) {
    const place = roomCluster(item.room_id);
    if (!place) continue;
    tally.set(place, (tally.get(place) || 0) + 1);
  }
  let place = "la planta";
  let best = 0;
  for (const [key, count] of tally) {
    if (count > best) {
      best = count;
      place = key;
    }
  }
  const noun = deaths.length === 1 ? "muerte" : "muertes";
  return `${deaths.length} ${noun} en ${minutes} min – ritmo anómalo, revisar ${place}`;
}

export default function PatientFlow({ movements, linked, syncedAt, onOpenMovement }) {
  const [filter, setFilter] = useState("all");
  const [grep, setGrep] = useState("");
  const [thread, setThread] = useState("");
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState(null);
  const [cursor, setCursor] = useState(0);
  const [acked, setAcked] = useState(() => new Set());
  const [freshId, setFreshId] = useState(null);
  const [copied, setCopied] = useState(false);
  const [tick, setTick] = useState(() => Date.now());
  const seen = useRef(null);
  const grepRef = useRef(null);
  const logRef = useRef(null);
  const patientsRef = useRef([]);
  const rowsRef = useRef([]);
  const cursorRef = useRef(0);
  const pausedRef = useRef(false);
  const threadRef = useRef("");
  const openRef = useRef(onOpenMovement);

  const patients = useMemo(() => movements.filter(isPatientEvent), [movements]);
  patientsRef.current = patients;
  pausedRef.current = paused;
  threadRef.current = thread;
  openRef.current = onOpenMovement;

  useEffect(() => {
    const timer = setInterval(() => setTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

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

  const source = paused && frozen ? frozen : patients;
  const needle = grepNeedle(grep);

  const counts = useMemo(() => {
    const tally = { all: source.length };
    for (const bucket of PATIENT_BUCKETS) tally[bucket.id] = 0;
    for (const item of source) tally[flowBucket(item)] += 1;
    return tally;
  }, [source]);

  const rows = useMemo(() => {
    let next = source;
    if (thread) next = next.filter((item) => sameName(item, thread));
    if (filter !== "all") next = next.filter((item) => flowBucket(item) === filter);
    if (needle) next = next.filter((item) => matchesGrep(item, needle));
    if (!thread) return next;
    return [...next].sort((a, b) => a.id - b.id);
  }, [source, thread, filter, needle]);

  rowsRef.current = rows;

  const threadMissing = Boolean(thread) && !patients.some((item) => sameName(item, thread));
  const queued = paused && frozen
    ? patients.filter((item) => !frozen.some((held) => held.id === item.id)).length
    : 0;

  const burst = useMemo(() => deathWatch(patients, tick), [patients, tick]);

  const syncAge = syncedAt == null ? null : Math.max(0, Math.round((tick - syncedAt) / 1000));

  useEffect(() => {
    setCursor((current) => {
      if (!rows.length) return 0;
      return Math.min(current, rows.length - 1);
    });
  }, [rows]);

  useEffect(() => {
    cursorRef.current = cursor;
    const id = rowsRef.current[cursor]?.id;
    if (id == null) return;
    logRef.current?.querySelector(`[data-flow-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  function acknowledge(id) {
    setAcked((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  }

  function togglePause() {
    setPaused((current) => {
      if (current) {
        setFrozen(null);
        return false;
      }
      setFrozen(patientsRef.current.slice());
      return true;
    });
  }

  async function copyVisible() {
    const list = rowsRef.current;
    if (!list.length) return;
    try {
      await navigator.clipboard.writeText(list.map(lineText).join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  useEffect(() => {
    function onKey(event) {
      const target = event.target;
      const field = target instanceof Element && target.closest("input, textarea, [contenteditable='true']");
      if (event.key === "Escape") {
        if (field && field === grepRef.current) {
          setGrep("");
          field.blur();
          event.preventDefault();
          return;
        }
        if (threadRef.current) {
          setThread("");
          setCursor(0);
          event.preventDefault();
        }
        return;
      }
      if (field) return;
      if (event.key === "/") {
        event.preventDefault();
        grepRef.current?.focus();
        return;
      }
      if (event.key === " ") {
        event.preventDefault();
        togglePause();
        return;
      }
      if ((event.key === "y" || event.key === "Y") && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        copyVisible();
        return;
      }
      const list = rowsRef.current;
      if (!list.length) return;
      if (event.key === "j" || event.key === "ArrowDown") {
        event.preventDefault();
        setCursor((index) => Math.min(list.length - 1, index + 1));
        return;
      }
      if (event.key === "k" || event.key === "ArrowUp") {
        event.preventDefault();
        setCursor((index) => Math.max(0, index - 1));
        return;
      }
      const onButton = target instanceof Element && target.closest("button, a");
      if (event.key === "Enter") {
        if (onButton) return;
        const item = list[cursorRef.current];
        if (item?.room_id) openRef.current?.(item);
        return;
      }
      if (event.key === "x" || event.key === "X") {
        const item = list[cursorRef.current];
        if (item && isCritical(item)) acknowledge(item.id);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const visibleBuckets = PATIENT_BUCKETS.filter((bucket) => SHOWN_BUCKETS.includes(bucket.id));

  return (
    <section className="flow-term" aria-label="Patient flow">
      {burst && (
        <p className="flow-burst" role="status">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M8 1.6 14.6 13.2H1.4L8 1.6Z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
            <path d="M8 6.2v3.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="8" cy="11.2" r="0.7" fill="currentColor" />
          </svg>
          {burst}
        </p>
      )}

      <div className="flow-head">
        <p className="flow-prompt">
          <span className="flow-host">flow@tiger-memorial</span>
          <span className="flow-sigil">~ %</span>
          {thread && <span className="flow-thread">thread {thread}</span>}
        </p>
        <label className="flow-grep">
          <input
            ref={grepRef}
            value={grep}
            onChange={(event) => {
              setGrep(event.target.value);
              setCursor(0);
            }}
            placeholder="/ buscar"
            spellCheck={false}
            aria-label="Filtrar el stream"
          />
        </label>
        <button
          type="button"
          className={paused ? "flow-pause is-on" : "flow-pause"}
          aria-pressed={paused}
          aria-label={paused ? "Reanudar el stream" : "Pausar el stream"}
          onClick={togglePause}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M5 3.5v9M11 3.5v9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
          {paused && queued > 0 && <em>+{queued}</em>}
        </button>
      </div>

      <div className="flow-filters" role="tablist" aria-label="Movement type">
        <button
          type="button"
          role="tab"
          aria-selected={filter === "all"}
          className={filter === "all" ? "is-on" : ""}
          onClick={() => {
            setFilter("all");
            setCursor(0);
          }}
        >
          Todos <b>{counts.all}</b>
        </button>
        {visibleBuckets.map((bucket) => (
          <button
            key={bucket.id}
            type="button"
            role="tab"
            aria-selected={filter === bucket.id}
            className={filter === bucket.id ? `is-on tone-${bucket.id}` : `tone-${bucket.id}`}
            onClick={() => {
              setFilter(bucket.id);
              setCursor(0);
            }}
          >
            {bucket.label} <b>{counts[bucket.id]}</b>
          </button>
        ))}
      </div>

      <div className="flow-log" ref={logRef}>
        {patients.length === 0 ? (
          <p className="flow-wait">esperando movimiento</p>
        ) : threadMissing ? (
          <p className="flow-wait">sin eventos de este paciente en las últimas 40 líneas</p>
        ) : rows.length === 0 ? (
          <p className="flow-wait">sin coincidencias</p>
        ) : (
          <ol>
            {rows.map((item, index) => {
              const kind = kindFor(item);
              const fresh = item.id === freshId;
              const critical = isCritical(item);
              const held = critical && !acked.has(item.id);
              const selected = index === cursor;
              const { name, rest } = splitMessage(item);
              const className = [
                "flow-line",
                `tone-${kind.id}`,
                fresh ? "is-fresh" : "",
                held ? "is-held" : "",
                selected ? "is-selected" : "",
              ].filter(Boolean).join(" ");
              return (
                <li key={item.id} className={className} data-flow-id={item.id} aria-selected={selected}>
                  <div className="flow-line-btn">
                    <time dateTime={item.created_at || undefined}>{eventClock(item.created_at)}</time>
                    <em className="flow-kind">{kind.code}</em>
                    <span className="flow-msg">
                      {name && (
                        <button
                          type="button"
                          className="flow-name"
                          onClick={() => {
                            setThread(name);
                            setCursor(0);
                          }}
                        >
                          {name}
                        </button>
                      )}
                      {item.room_id ? (
                        <button
                          type="button"
                          className="flow-phrase"
                          onClick={() => {
                            setCursor(index);
                            onOpenMovement(item);
                          }}
                        >
                          {rest}
                        </button>
                      ) : (
                        <span className="flow-phrase">{rest}</span>
                      )}
                    </span>
                    {held ? (
                      <button
                        type="button"
                        className="flow-ack"
                        aria-label={`Marcar ${kind.code} visto`}
                        onClick={() => {
                          setCursor(index);
                          acknowledge(item.id);
                        }}
                      >
                        <svg viewBox="0 0 16 16" aria-hidden="true">
                          <path d="M2.2 2.2l11.6 11.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                          <path d="M6.2 6.4A4.2 4.2 0 0 0 3 8.2S4.6 11.4 8 11.4c.6 0 1.2-.1 1.7-.4M7.1 4.8A4.4 4.4 0 0 1 8 4.7c3.4 0 5 3.5 5 3.5a7.4 7.4 0 0 1-1.5 2" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <footer className="flow-term-foot">
        <span className={linked ? "is-linked" : "is-stale"}>
          {linked ? "LIVE" : "HOLD"}
          {" · "}
          {syncAge == null ? "sync --" : `sync ${syncAge}s`}
        </span>
        <span>{rows.length} en pantalla</span>
        <button type="button" className={copied ? "is-copied" : ""} onClick={copyVisible}>
          {copied ? "copiado" : "copiar"}
        </button>
      </footer>
    </section>
  );
}
