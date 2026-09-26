import { useEffect, useMemo, useRef, useState } from "react";
import { DEPT } from "./floors";

const MIX = {
  critical: "var(--red)",
  stable: "#64748b",
  cleaning: "#cbd5e1",
  available: "#e2e8f0",
};

const FLOW_BUCKETS = [
  { id: "admit", label: "Admit" },
  { id: "move", label: "Transfer" },
  { id: "or", label: "OR" },
  { id: "discharge", label: "Discharge" },
  { id: "divert", label: "Divert" },
  { id: "turnover", label: "Turnover" },
];

function tally(rooms) {
  const beds = rooms.filter((room) => room.census);
  const available = beds.filter((room) => room.status === "available").length;
  const critical = beds.filter((room) => room.status === "critical").length;
  const cleaning = beds.filter((room) => room.status === "cleaning").length;
  const stable = beds.filter((room) => room.status === "normal" || room.status === "warning").length;
  return {
    total: beds.length,
    available,
    critical,
    cleaning,
    stable,
    occupied: stable + critical,
  };
}

function floorRank(code) {
  if (code === "B1") return -1;
  const level = Number(String(code).replace(/\D/g, ""));
  return Number.isFinite(level) ? level : 99;
}

function pct(part, total) {
  if (!total) return 0;
  return Math.round((part / total) * 100);
}

function clock(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function flowBucket(message) {
  const text = (message || "").toLowerCase();
  if (text.includes("admitted")) return "admit";
  if (text.includes("discharged")) return "discharge";
  if (text.includes("sent to")) return "divert";
  if (text.includes("left the or") || / in or-/.test(text)) return "or";
  if (text.includes(" is open")) return "turnover";
  return "move";
}

function toneClass(share) {
  if (share >= 85) return "is-red";
  if (share >= 70) return "is-amber";
  return "";
}

function useCount(value, duration = 500) {
  const numeric = Number(value) || 0;
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    const start = from.current;
    const end = numeric;
    const began = performance.now();
    let frame = 0;
    function tick(now) {
      const progress = Math.min(1, (now - began) / duration);
      const eased = 1 - (1 - progress) ** 3;
      setShown(Math.round(start + (end - start) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else from.current = end;
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [numeric, duration]);

  return shown;
}

export default function Overview({
  hospital,
  surgeOn,
  transfers,
  movements,
  onOpenFloor,
  onOpenMovement,
  onDeclareSurge,
}) {
  const model = useMemo(() => {
    const rooms = hospital.flatMap((floor) => floor.rooms);
    const house = tally(rooms);
    const floors = hospital
      .map((floor) => ({
        ...tally(floor.rooms),
        id: floor.id,
        code: floor.code,
        name: floor.name,
        subtitle: floor.subtitle,
      }))
      .filter((floor) => floor.total > 0)
      .sort((a, b) => floorRank(a.code) - floorRank(b.code));

    const grouped = new Map();
    for (const room of rooms) {
      if (!room.census || !room.dept) continue;
      const id = room.dept === "trauma" ? "ed" : room.dept;
      const current = grouped.get(id) || [];
      current.push(room);
      grouped.set(id, current);
    }
    const departments = [...grouped.entries()]
      .map(([id, deptRooms]) => ({
        id,
        label: DEPT[id]?.label || deptRooms[0].deptLabel,
        ...tally(deptRooms),
      }))
      .filter((dept) => dept.total > 0)
      .sort((a, b) => pct(b.occupied, b.total) - pct(a.occupied, a.total));

    const icu = tally(rooms.filter((room) => room.dept === "icu"));
    const ed = tally(rooms.filter((room) => room.dept === "ed" || room.dept === "trauma"));
    const or = tally(rooms.filter((room) => room.kind === "or"));
    const flow = FLOW_BUCKETS.map((bucket) => ({
      ...bucket,
      value: movements.filter((item) => flowBucket(item.message) === bucket.id).length,
    }));

    return { house, floors, departments, icu, ed, or, flow };
  }, [hospital, movements]);

  const icuDiverted = transfers.filter((item) => item.reason === "icu_full").length;
  const orDiverted = transfers.filter((item) => item.reason === "or_full").length;
  const occupiedShare = pct(model.house.occupied, model.house.total);
  const slices = [
    { id: "critical", label: "Critical", value: model.house.critical, color: MIX.critical },
    { id: "stable", label: "Stable", value: model.house.stable, color: MIX.stable },
    { id: "cleaning", label: "Cleaning", value: model.house.cleaning, color: MIX.cleaning },
    { id: "available", label: "Available", value: model.house.available, color: MIX.available },
  ];

  return (
    <div className="cmd">
      <header className="cmd-top">
        <div className="cmd-intro">
          <p className="kicker">Hospital census</p>
          <h2>Tiger Memorial</h2>
          <p>Live bed mix for every floor with patients. Open a floor to see it on the map.</p>
        </div>
        <section className={surgeOn ? "cmd-banner is-hot" : "cmd-banner"} aria-label="Active incident">
          <p className="kicker">{surgeOn ? "Surge declared" : "Active incident"}</p>
          <strong>Train collision — MCI</strong>
          <p>
            {surgeOn
              ? "Emergency on F1 and ICU on F3 are holding the incoming critical patients."
              : "Rail incident. Emergency and ICU are the receiving units."}
          </p>
          <button type="button" className="surge-btn cmd-surge" onClick={onDeclareSurge} disabled={surgeOn}>
            {surgeOn ? "Surge declared" : "Declare surge"}
          </button>
        </section>
      </header>

      <section className="cmd-kpis" aria-label="Hospital totals">
        <Kpi label="Occupancy" value={occupiedShare} suffix="%" note={`${model.house.occupied} of ${model.house.total} beds`} />
        <Kpi label="Available" value={model.house.available} note="Open right now" />
        <Kpi label="Occupied" value={model.house.occupied} note="Includes critical" />
        <Kpi label="Critical" value={model.house.critical} note="Subset of occupied" live={model.house.critical > 0} />
        <Kpi label="Cleaning" value={model.house.cleaning} note="Not free yet" />
      </section>

      <section className="cmd-plots">
        <article className="cmd-block">
          <h3>Bed mix</h3>
          <p className="overview-sub">Every census bed in the building.</p>
          <MixBar slices={slices} total={model.house.total} />
        </article>
        <article className="cmd-block">
          <h3>Occupancy by floor</h3>
          <p className="overview-sub">Select a floor for the map.</p>
          <FloorBullets floors={model.floors} onOpen={onOpenFloor} />
        </article>
      </section>

      <section className="cmd-rings" aria-label="Receiving units">
        <Ring label="Intensive Care" unit={model.icu} note={icuDiverted ? `${icuDiverted} diverted · ICU full` : "F3 receiving unit"} />
        <Ring label="Emergency" unit={model.ed} note="F1 and trauma bays on F3" />
        <Ring label="Operating rooms" unit={model.or} note={orDiverted ? `${orDiverted} diverted · ORs full` : "Both theatres on F3"} />
      </section>

      <section className="cmd-plots">
        <article className="cmd-block">
          <h3>Departments</h3>
          <p className="overview-sub">Share of beds in each unit, tightest first.</p>
          <DeptBars rows={model.departments} />
        </article>
        <article className="cmd-block">
          <h3>Movement mix</h3>
          <p className="overview-sub">Admissions in. Discharges and diversions out.</p>
          <Waterfall flow={model.flow} empty={movements.length === 0} />
        </article>
      </section>

      <article className="cmd-block">
        <h3>Latest movements</h3>
        <p className="overview-sub">Five most recent. The full log stays in Patient Flow.</p>
        {movements.length === 0 ? (
          <p className="cmd-empty">No movement yet. The census updates every few seconds.</p>
        ) : (
          <ul className="cmd-feed">
            {movements.slice(0, 5).map((item) => (
              <li key={item.id}>
                {item.room_id ? (
                  <button type="button" className="cmd-shift" onClick={() => onOpenMovement(item)}>
                    <time>{clock(item.created_at)}</time>
                    <span>{item.message}</span>
                    <em>{item.room_id}</em>
                  </button>
                ) : (
                  <div className="cmd-shift">
                    <time>{clock(item.created_at)}</time>
                    <span>{item.message}</span>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </article>
    </div>
  );
}

function Kpi({ label, value, suffix = "", note, live = false }) {
  const shown = useCount(value);
  return (
    <div className={live ? "cmd-kpi is-live" : "cmd-kpi"}>
      <span>{label}</span>
      <strong>{shown}{suffix}</strong>
      <small>{note}</small>
    </div>
  );
}

function MixBar({ slices, total }) {
  return (
    <div>
      <div className="cmd-mix" role="img" aria-label="Bed mix">
        {slices.map((slice) => (
          total ? (
            <i
              key={slice.id}
              className="cmd-fill"
              style={{ width: `${(slice.value / total) * 100}%`, background: slice.color }}
              title={`${slice.label}: ${slice.value}`}
            />
          ) : null
        ))}
      </div>
      <ul className="cmd-legend">
        {slices.map((slice) => (
          <li key={slice.id}>
            <i style={{ background: slice.color }} />
            <span>{slice.label}</span>
            <strong>{slice.value}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

function FloorBullets({ floors, onOpen }) {
  return (
    <ul className="cmd-bullets">
      {floors.map((floor) => {
        const share = pct(floor.occupied, floor.total);
        return (
          <li key={floor.id}>
            <button type="button" onClick={() => onOpen(floor.id)}>
              <span className="cmd-code">{floor.code}</span>
              <span className="cmd-track">
                <i className="cmd-mark" style={{ left: "70%" }} />
                <i className="cmd-mark is-limit" style={{ left: "85%" }} />
                <i className={`cmd-bar cmd-fill ${toneClass(share)}`} style={{ width: `${share}%` }} />
              </span>
              <strong>{share}%</strong>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function Ring({ label, unit, note }) {
  const open = useCount(unit.available);
  const share = pct(unit.occupied, unit.total);
  const radius = 46;
  const length = 2 * Math.PI * radius;
  const drawn = (share / 100) * length;
  return (
    <article className="cmd-unit">
      <p className="kicker">{label}</p>
      <div className="cmd-ring-wrap">
        <svg viewBox="0 0 120 120" className="cmd-ring" role="img" aria-label={`${label}, ${unit.available} open, ${share} percent occupied`}>
          <circle cx="60" cy="60" r={radius} fill="none" stroke="#e6ebf2" strokeWidth="3" />
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            className={`cmd-ring-value ${toneClass(share)}`}
            strokeWidth="3"
            style={{ "--c": length, "--rest": length - drawn }}
            transform="rotate(-90 60 60)"
          />
        </svg>
        <div className="cmd-ring-read">
          <strong>{open}</strong>
          <span>open</span>
        </div>
      </div>
      <p>{unit.occupied} of {unit.total} in use. {note}</p>
    </article>
  );
}

function DeptBars({ rows }) {
  if (rows.length === 0) return <p className="cmd-empty">No census beds.</p>;
  return (
    <ul className="cmd-depts">
      {rows.map((row) => {
        const share = pct(row.occupied, row.total);
        return (
          <li key={row.id} className="cmd-shift">
            <span>{row.label}</span>
            <div className="cmd-stack" title={`${row.occupied} occupied of ${row.total}`}>
              <i className="cmd-fill" style={{ width: `${(row.critical / row.total) * 100}%`, background: MIX.critical }} />
              <i className="cmd-fill" style={{ width: `${(row.stable / row.total) * 100}%`, background: MIX.stable }} />
              <i className="cmd-fill" style={{ width: `${(row.cleaning / row.total) * 100}%`, background: MIX.cleaning }} />
              <i className="cmd-fill" style={{ width: `${(row.available / row.total) * 100}%`, background: MIX.available }} />
            </div>
            <strong>{share}%</strong>
          </li>
        );
      })}
    </ul>
  );
}

function Waterfall({ flow, empty }) {
  if (empty) return <p className="cmd-empty">No movement yet. The census updates every few seconds.</p>;
  const count = (id) => flow.find((row) => row.id === id)?.value || 0;
  const incoming = count("admit");
  const inside = count("move") + count("or") + count("turnover");
  const outgoing = count("discharge") + count("divert");
  const peak = Math.max(incoming, inside, outgoing, 1);
  const steps = [
    {
      id: "in",
      label: "In",
      amount: incoming,
      sign: "+",
      detail: `Admit ${incoming}`,
    },
    {
      id: "mid",
      label: "Inside",
      amount: inside,
      sign: "",
      detail: `Transfer ${count("move")} · OR ${count("or")} · Turnover ${count("turnover")}`,
    },
    {
      id: "out",
      label: "Out",
      amount: outgoing,
      sign: "−",
      detail: `Discharge ${count("discharge")} · Divert ${count("divert")}`,
    },
  ];
  return (
    <div className="cmd-fall" role="img" aria-label="Patient flow, admissions in, discharges and diversions out">
      {steps.map((step) => (
        <div key={step.id} className={`cmd-fall-step is-${step.id}`}>
          <span className="kicker">{step.label}</span>
          <div className="cmd-fall-plot">
            <i className="cmd-fill" style={{ height: `${Math.max((step.amount / peak) * 100, step.amount ? 6 : 0)}%` }} />
          </div>
          <strong>{step.sign}{step.amount}</strong>
          <small>{step.detail}</small>
        </div>
      ))}
    </div>
  );
}
