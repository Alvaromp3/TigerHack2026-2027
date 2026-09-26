import { useEffect, useMemo, useRef, useState } from "react";
import { apiUrl } from "../api/client";
import { FLOW_BUCKETS, flowBucket } from "./flowBuckets";

const CHIPS = [
  { id: "all", label: "Todos" },
  { id: "admit", label: "Ingreso" },
  { id: "move", label: "Traslado" },
  { id: "or", label: "Quirófano" },
  { id: "discharge", label: "Alta" },
  { id: "divert", label: "Desvío" },
  { id: "death", label: "Muerte" },
];

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
  return FLOW_BUCKETS.find((bucket) => bucket.id === id) || FLOW_BUCKETS[1];
}

function splitMessage(item) {
  const name = (item.patient_name || "").trim();
  const message = item.message || "";
  if (name && message.toLowerCase().startsWith(name.toLowerCase())) {
    return { name, rest: message.slice(name.length).trimStart() };
  }
  return { name, rest: message.trim() };
}

export default function PatientFlow({ movements, linked, syncedAt, onOpenMovement }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [freshId, setFreshId] = useState(null);
  const [tick, setTick] = useState(() => Date.now());
  const seen = useRef(null);

  const live = useMemo(() => movements.filter(isPatientEvent), [movements]);
  const needle = query.trim();

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

  useEffect(() => {
    if (!needle) {
      setHits(null);
      setSearching(false);
      setSearchError("");
      return undefined;
    }
    setHits(null);
    setSearching(true);
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(apiUrl(`/api/flow?q=${encodeURIComponent(needle)}`), { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (!controller.signal.aborted) {
          setHits((body.events || []).filter(isPatientEvent));
          setSearchError("");
        }
      } catch (error) {
        if (error.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setHits([]);
          setSearchError("No se pudo buscar el historial.");
        }
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 280);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [needle]);

  const source = needle ? hits || [] : live;

  const counts = useMemo(() => {
    const tally = { all: source.length };
    for (const chip of CHIPS) {
      if (chip.id !== "all") tally[chip.id] = 0;
    }
    for (const item of source) {
      const id = flowBucket(item);
      if (tally[id] != null) tally[id] += 1;
    }
    return tally;
  }, [source]);

  const rows = useMemo(() => {
    if (filter === "all") return source;
    return source.filter((item) => flowBucket(item) === filter);
  }, [source, filter]);

  const syncAge = syncedAt == null ? null : Math.max(0, Math.round((tick - syncedAt) / 1000));

  return (
    <section className="pf" aria-label="Patient flow">
      <header className="pf-head">
        <div>
          <h2>Patient flow</h2>
          <p>Ingresos, traslados, altas y muertes en el momento en que ocurren.</p>
        </div>
        <span className={linked ? "pf-live is-on" : "pf-live"}>
          <i />
          {linked ? "LIVE" : "HOLD"}
          {" · "}
          {syncAge == null ? "sync --" : `sync ${syncAge}s`}
        </span>
      </header>

      <label className="pf-search">
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setFilter("all");
          }}
          placeholder="Buscar historial por nombre, habitación o evento"
          spellCheck={false}
          aria-label="Buscar el historial"
        />
      </label>

      <div className="pf-filters" role="tablist" aria-label="Tipo de movimiento">
        {CHIPS.map((chip) => (
          <button
            key={chip.id}
            type="button"
            role="tab"
            aria-selected={filter === chip.id}
            className={filter === chip.id ? `is-on tone-${chip.id}` : `tone-${chip.id}`}
            onClick={() => setFilter(chip.id)}
          >
            {chip.label} <b>{counts[chip.id] || 0}</b>
          </button>
        ))}
      </div>

      <p className="pf-scope">
        {needle
          ? searching
            ? "Buscando en el historial"
            : `Historial · ${rows.length} resultado${rows.length === 1 ? "" : "s"}`
          : `En vivo · últimas líneas`}
      </p>

      <div className="pf-log">
        {searchError ? (
          <p className="pf-empty">{searchError}</p>
        ) : searching && needle ? (
          <p className="pf-empty">Buscando…</p>
        ) : rows.length === 0 ? (
          <p className="pf-empty">{needle ? "Sin coincidencias" : "Esperando movimiento"}</p>
        ) : (
          <ol>
            {rows.map((item) => {
              const kind = kindFor(item);
              const fresh = !needle && item.id === freshId;
              const { name, rest } = splitMessage(item);
              return (
                <li key={item.id} className={fresh ? `pf-line tone-${kind.id} is-fresh` : `pf-line tone-${kind.id}`}>
                  <div className="pf-row">
                    <time dateTime={item.created_at || undefined}>{eventClock(item.created_at)}</time>
                    <em>{chipLabel(kind.id)}</em>
                    {name ? (
                      <button
                        type="button"
                        className="pf-name"
                        onClick={() => {
                          setQuery(name);
                          setFilter("all");
                        }}
                      >
                        {name}
                      </button>
                    ) : (
                      <span className="pf-name">{item.patient_name || "—"}</span>
                    )}
                    {item.room_id ? (
                      <button type="button" className="pf-phrase" onClick={() => onOpenMovement(item)}>
                        {rest || item.message}
                      </button>
                    ) : (
                      <span className="pf-phrase">{rest || item.message}</span>
                    )}
                    {item.room_id ? (
                      <button type="button" className="pf-room" onClick={() => onOpenMovement(item)}>
                        {item.room_id}
                      </button>
                    ) : (
                      <span className="pf-room" />
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}

function chipLabel(id) {
  return CHIPS.find((chip) => chip.id === id)?.label || id;
}
