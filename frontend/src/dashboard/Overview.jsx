import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DEPT } from "./floors";
import { FLOW_BUCKETS, flowBucket } from "./flowBuckets";

const INK = "#020c21";
const CRITICAL = "#cf4b3e";
const STABLE = "#4a78b0";
const OPEN = "#3f9142";
const WATCH = "#cc8a2c";
const LINE = "#dde4ee";
const MUTED = "#59627e";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "flow", label: "Patient flow" },
  { id: "staff", label: "Staffing" },
  { id: "alerts", label: "Alerts" },
];

const SPARK = {
  occupancy: { color: CRITICAL, suffix: "%", fraction: 0.105, shape: { freq: 2.2, phase: 0.4, amp: 1 } },
  available: { color: OPEN, suffix: "", fraction: -0.2, shape: { freq: 1.4, phase: 1.1, amp: 0.7 } },
  occupied: { color: INK, suffix: "", fraction: 0.16, shape: { freq: 2.6, phase: 0.2, amp: 0.55 } },
  critical: { color: CRITICAL, suffix: "", fraction: 0.2, shape: { freq: 1.6, phase: 0.8, amp: 0.45 } },
  cleaning: { color: "#a3a29a", suffix: "", fraction: 0, shape: { freq: 1, phase: 0, amp: 0 } },
};

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

function barTone(share) {
  if (share >= 85) return CRITICAL;
  if (share >= 70) return WATCH;
  return STABLE;
}

function shortDept(label) {
  if (label.startsWith("Emergency")) return "Emergency";
  if (label.startsWith("Medical")) return "Medical / Surg.";
  if (label.startsWith("Surgery")) return "Surgery";
  return label;
}

function metricDelta(id, value) {
  if (!value) return 0;
  const fraction = SPARK[id].fraction;
  if (!fraction) return 0;
  const raw = value * fraction;
  const rounded = raw > 0 ? Math.max(1, Math.round(raw)) : Math.min(-1, Math.round(raw));
  return rounded;
}

function formatDelta(delta, suffix) {
  if (!delta) return "–";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}${suffix}`;
}

function sparkPoints(end, delta, shape) {
  const steps = 18;
  const start = end - delta;
  const values = [];
  for (let i = 0; i < steps; i += 1) {
    const t = i / (steps - 1);
    const base = start + delta * t;
    const wave = Math.sin(t * Math.PI * shape.freq + shape.phase) * shape.amp * Math.max(Math.abs(end) * 0.045, 0.6);
    values.push(base + wave);
  }
  values[values.length - 1] = end;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((value, index) => {
      const x = (index / (steps - 1)) * 100;
      const y = 28 - ((value - min) / span) * 22;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
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

function useDraw(token) {
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    setDrawn(false);
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, [token]);
  return drawn;
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
  const [tab, setTab] = useState("overview");
  const model = useMemo(() => {
    const rooms = hospital.flatMap((floor) => floor.rooms);
    const house = tally(rooms);
    const floors = hospital
      .map((floor) => ({
        ...tally(floor.rooms),
        id: floor.id,
        code: floor.code,
        name: floor.name,
        charge: floor.charge,
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
        label: shortDept(DEPT[id]?.label || deptRooms[0].deptLabel),
        ...tally(deptRooms),
      }))
      .filter((dept) => dept.total > 0)
      .sort((a, b) => pct(b.occupied, b.total) - pct(a.occupied, a.total));

    const icu = tally(rooms.filter((room) => room.dept === "icu"));
    const ed = tally(rooms.filter((room) => room.dept === "ed" || room.dept === "trauma"));
    const or = tally(rooms.filter((room) => room.kind === "or"));
    const flow = Object.fromEntries(
      FLOW_BUCKETS.map((bucket) => [
        bucket.id,
        movements.filter((item) => flowBucket(item.message) === bucket.id).length,
      ]),
    );
    const staff = floors.map((floor) => {
      const crew = hospital
        .find((level) => level.id === floor.id)
        ?.rooms.filter((room) => room.census && (room.physician || room.nurse)) || [];
      const physicians = [...new Set(crew.map((room) => room.physician).filter(Boolean))];
      const nurses = [...new Set(crew.map((room) => room.nurse).filter(Boolean))];
      return { ...floor, physicians, nurses };
    });

    return { house, floors, departments, icu, ed, or, flow, staff };
  }, [hospital, movements]);

  const [floorId, setFloorId] = useState(model.floors[0]?.id || "");
  const occupiedShare = pct(model.house.occupied, model.house.total);
  const icuDiverted = transfers.filter((item) => item.reason === "icu_full").length;
  const hottest = model.departments.find((dept) => pct(dept.occupied, dept.total) >= 85);

  const metrics = [
    { id: "occupancy", label: "Occupancy", value: occupiedShare, suffix: "%" },
    { id: "available", label: "Available", value: model.house.available, suffix: "" },
    { id: "occupied", label: "Occupied", value: model.house.occupied, suffix: "" },
    { id: "critical", label: "Critical", value: model.house.critical, suffix: "", alert: true },
    { id: "cleaning", label: "Cleaning", value: model.house.cleaning, suffix: "" },
  ];

  const slices = [
    { id: "critical", label: "Critical", value: model.house.critical, color: CRITICAL },
    { id: "stable", label: "Stable", value: model.house.stable, color: STABLE },
    { id: "available", label: "Available", value: model.house.available, color: OPEN, soft: "#c5ddd0" },
  ];

  return (
    <div className="ov">
      <header className="ov-head">
        <div>
          <h2>Tiger Memorial</h2>
          <p>Live bed mix for every floor. Open a floor to see it on the map.</p>
        </div>
        <button type="button" className="ov-surge" onClick={onDeclareSurge} disabled={surgeOn}>
          {surgeOn ? "Surge declared" : "Declare surge"}
        </button>
      </header>

      <nav className="ov-tabs" aria-label="Census">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "is-on" : ""}
            aria-current={tab === item.id ? "page" : undefined}
            onClick={() => setTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {tab === "overview" && (
        <>
          <section className="ov-metrics" aria-label="Hospital totals">
            {metrics.map((metric) => (
              <Metric key={metric.id} metric={metric} />
            ))}
          </section>

          <section className="ov-split">
            <article>
              <h3>Bed mix <span>— every census bed in the building</span></h3>
              <MixBar slices={slices} total={model.house.total} />
            </article>
            <article>
              <div className="ov-floor-head">
                <h3>Occupancy by floor <span>— threshold at 70 / 85%</span></h3>
                <div className="ov-pills" role="group" aria-label="Floors">
                  {model.floors.map((floor) => (
                    <button
                      key={floor.id}
                      type="button"
                      className={floor.id === floorId ? "is-on" : ""}
                      aria-pressed={floor.id === floorId}
                      onClick={() => setFloorId(floor.id)}
                    >
                      {floor.code}
                    </button>
                  ))}
                </div>
              </div>
              <ul className="ov-floors">
                {model.floors.map((floor) => {
                  const share = pct(floor.occupied, floor.total);
                  return (
                    <li key={floor.id}>
                      <button type="button" className={floor.id === floorId ? "is-on" : ""} onClick={() => onOpenFloor(floor.id)}>
                        <span>{floor.code}</span>
                        <Bullet share={share} />
                        <strong>{share}%</strong>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </article>
          </section>

          <section className="ov-rings" aria-label="Receiving units">
            <Ring
              label="Intensive Care"
              unit={model.icu}
              note={icuDiverted
                ? `${model.icu.occupied} of ${model.icu.total} in use · ${icuDiverted} diverted`
                : `${model.icu.occupied} of ${model.icu.total} in use`}
            />
            <Ring label="Emergency" unit={model.ed} note={`${model.ed.occupied} of ${model.ed.total} in use`} />
            <Ring label="Operating rooms" unit={model.or} note={`${model.or.occupied} of ${model.or.total} in use`} />
          </section>

          <section className="ov-split ov-bottom">
            <article>
              <h3>Departments <span>— tightest first</span></h3>
              <ul className="ov-depts">
                {model.departments.map((dept) => {
                  const share = pct(dept.occupied, dept.total);
                  return (
                    <li key={dept.id} className={hottest?.id === dept.id ? "is-hot" : ""}>
                      <span>{dept.label}</span>
                      <i title={`${dept.occupied} occupied of ${dept.total}`}>
                        <b style={{ width: `${(dept.critical / dept.total) * 100}%`, background: CRITICAL }} />
                        <b style={{ width: `${(dept.stable / dept.total) * 100}%`, background: STABLE }} />
                        <b style={{ width: `${((dept.total - dept.critical - dept.stable) / dept.total) * 100}%`, background: "#e6e3db" }} />
                      </i>
                      <strong>{share}%</strong>
                    </li>
                  );
                })}
              </ul>
            </article>
            <article>
              <h3>Movement mix <span>— admissions in, discharges and diversions out</span></h3>
              <Sankey
                admit={model.flow.admit}
                transfer={model.flow.move + model.flow.or}
                discharge={model.flow.discharge}
                divert={model.flow.divert}
                turnover={model.flow.turnover}
              />
            </article>
          </section>
        </>
      )}

      {tab === "flow" && (
        <section className="ov-panel">
          <h3>Patient flow <span>— latest movement</span></h3>
          {movements.length === 0 ? (
            <p className="ov-empty">No movement yet. The census updates every few seconds.</p>
          ) : (
            <ul className="ov-feed">
              {movements.map((item) => (
                <li key={item.id}>
                  {item.room_id ? (
                    <button type="button" onClick={() => onOpenMovement(item)}>
                      <time>{clock(item.created_at)}</time>
                      <span>{item.message}</span>
                      <em>{item.room_id}</em>
                    </button>
                  ) : (
                    <div>
                      <time>{clock(item.created_at)}</time>
                      <span>{item.message}</span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "staff" && (
        <section className="ov-panel">
          <h3>Staffing <span>— charge nurse and the crew on occupied beds</span></h3>
          <ul className="ov-staff">
            {model.staff.map((floor) => (
              <li key={floor.id}>
                <strong>{floor.code}</strong>
                <span>{floor.charge || "No charge nurse"}</span>
                <em>{floor.physicians.join(", ") || "—"}</em>
                <small>{floor.nurses.join(", ") || "No nurses assigned"}</small>
              </li>
            ))}
          </ul>
        </section>
      )}

      {tab === "alerts" && (
        <section className="ov-panel">
          <h3>Alerts <span>— active incident</span></h3>
          <p className="ov-alert">
            {surgeOn
              ? "Surge is declared. Emergency on F1 and ICU on F3 are holding the incoming critical patients."
              : "Train collision. Emergency and ICU are the receiving units."}
          </p>
          {transfers.length === 0 ? (
            <p className="ov-empty">No diversions yet.</p>
          ) : (
            <ul className="ov-feed">
              {transfers.map((item) => (
                <li key={item.id}>
                  <div>
                    <time>{item.patient_name}</time>
                    <span>{item.destination}</span>
                    <em>{item.reason === "icu_full" ? "ICU full" : "ORs full"}</em>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

function Metric({ metric }) {
  const shown = useCount(metric.value);
  const spec = SPARK[metric.id];
  const delta = metricDelta(metric.id, metric.value);
  const points = sparkPoints(metric.value, delta, spec.shape);
  return (
    <div className={metric.alert ? "ov-metric is-alert" : "ov-metric"}>
      <span>{metric.label}</span>
      <p>
        <strong>{shown}{metric.suffix}</strong>
        <em style={{ color: delta ? spec.color : MUTED }}>{formatDelta(delta, spec.suffix)}</em>
      </p>
      <Sparkline points={points} color={spec.color} />
    </div>
  );
}

function Sparkline({ points, color }) {
  const ref = useRef(null);
  const [length, setLength] = useState(120);
  const [drawn, setDrawn] = useState(false);

  useLayoutEffect(() => {
    setDrawn(false);
    setLength(ref.current?.getTotalLength() || 120);
  }, [points]);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setDrawn(true));
    return () => cancelAnimationFrame(frame);
  }, [points, length]);

  return (
    <svg className="ov-spark" viewBox="0 0 100 32" preserveAspectRatio="none" aria-hidden="true">
      <polyline
        ref={ref}
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        style={{
          strokeDasharray: length,
          strokeDashoffset: drawn ? 0 : length,
        }}
      />
    </svg>
  );
}

function MixBar({ slices, total }) {
  const shown = slices.filter((slice) => slice.value > 0);
  return (
    <div>
      <div className="ov-mix" role="img" aria-label="Bed mix">
        {shown.map((slice) => (
          total ? (
            <i
              key={slice.id}
              style={{ width: `${(slice.value / total) * 100}%`, background: slice.soft || slice.color }}
              title={`${slice.label}: ${slice.value}`}
            />
          ) : null
        ))}
      </div>
      <ul className="ov-legend">
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

function Bullet({ share }) {
  const drawn = useDraw(share);
  return (
    <svg className="ov-bullet" viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1="7" x2="100" y2="7" stroke="#e7e4dc" strokeWidth="7" strokeLinecap="butt" />
      <line
        x1="0"
        y1="7"
        x2="100"
        y2="7"
        stroke={barTone(share)}
        strokeWidth="7"
        strokeLinecap="butt"
        pathLength="100"
        style={{
          strokeDasharray: 100,
          strokeDashoffset: drawn ? 100 - share : 100,
        }}
      />
      <line x1="70" y1="1" x2="70" y2="13" stroke={WATCH} strokeWidth="1" vectorEffect="non-scaling-stroke" />
      <line x1="85" y1="1" x2="85" y2="13" stroke={CRITICAL} strokeWidth="1" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Ring({ label, unit, note }) {
  const open = useCount(unit.available);
  const share = pct(unit.occupied, unit.total);
  const drawn = useDraw(share);
  const radius = 42;
  const length = 2 * Math.PI * radius;
  const rest = length - (share / 100) * length;
  const mark = (85 / 100) * length;
  return (
    <article className="ov-ring">
      <p>{label}</p>
      <div>
        <svg viewBox="0 0 120 120" role="img" aria-label={`${label}, ${unit.available} open`}>
          <circle cx="60" cy="60" r={radius} fill="none" stroke={LINE} strokeWidth="3.5" />
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke={barTone(share)}
            strokeWidth="3.5"
            strokeLinecap="butt"
            style={{
              strokeDasharray: length,
              strokeDashoffset: drawn ? rest : length,
            }}
            transform="rotate(-90 60 60)"
          />
          <circle
            cx="60"
            cy="60"
            r={radius}
            fill="none"
            stroke={WATCH}
            strokeWidth="3.5"
            strokeLinecap="butt"
            style={{ strokeDasharray: `2 ${length}` , strokeDashoffset: length - mark }}
            transform="rotate(-90 60 60)"
          />
        </svg>
        <div>
          <strong>{open}</strong>
          <span>Open</span>
        </div>
      </div>
      <small>{note}</small>
    </article>
  );
}

function Sankey({ admit, transfer, discharge, divert, turnover }) {
  const height = 168;
  const top = 18;
  const band = height - 36;
  const leftItems = [
    { id: "admit", label: "Admit", value: admit, color: "#8ea4b4" },
    { id: "transfer", label: "Transfer", value: transfer, color: "#d7b56a" },
  ];
  const rightItems = [
    { id: "discharge", label: "Discharge", value: discharge, color: "#8ea4b4" },
    { id: "divert", label: "Divert", value: divert, color: "#d7b56a" },
    { id: "turnover", label: "Turnover", value: turnover, color: "#9dbeae" },
  ];
  const layout = useMemo(() => buildSankey(leftItems, rightItems, top, band), [admit, transfer, discharge, divert, turnover, band]);
  const x1 = 168;
  const x2 = 318;

  return (
    <div className="ov-sankey" style={{ height }}>
      <svg viewBox={`0 0 480 ${height}`} role="img" aria-label="Patient movement from admit and transfer to discharge, divert, and turnover">
        {layout.links.map((link) => (
          <path key={`${link.from}-${link.to}`} d={ribbon(x1 + 8, link.y1a, link.y1b, x2, link.y2a, link.y2b)} fill={link.color} opacity="0.9" />
        ))}
        <rect x={x1} y={layout.leftTop} width="8" height={layout.leftHeight} fill={INK} />
        <rect x={x2} y={layout.rightTop} width="8" height={layout.rightHeight} fill={INK} />
      </svg>
      {layout.left.filter((item) => item.value > 0).map((item) => (
        <span key={item.id} className="is-left" style={{ top: `${((item.y0 + item.y1) / 2 / height) * 100}%` }}>
          {item.label} <b>{item.value}</b>
        </span>
      ))}
      {layout.right.filter((item) => item.value > 0).map((item) => (
        <span key={item.id} className="is-right" style={{ top: `${((item.y0 + item.y1) / 2 / height) * 100}%` }}>
          {item.label} <b>{item.value}</b>
        </span>
      ))}
    </div>
  );
}

function placeBands(items, top, height) {
  const active = items.some((item) => item.value > 0)
    ? items.filter((item) => item.value > 0)
    : items.map((item) => ({ ...item, value: 1, ghost: true }));
  const gap = active.length > 1 ? 5 : 0;
  const usable = height - gap * (active.length - 1);
  const total = active.reduce((sum, item) => sum + item.value, 0) || 1;
  let y = top;
  const bands = active.map((item) => {
    const span = Math.max((item.value / total) * usable, 8);
    const band = { ...item, y0: y, y1: y + span, value: item.ghost ? 0 : item.value };
    y += span + gap;
    return band;
  });
  const missing = items.filter((item) => !bands.some((band) => band.id === item.id));
  return { bands, missing };
}

function buildSankey(leftItems, rightItems, top, height) {
  const left = placeBands(leftItems, top, height);
  const right = placeBands(rightItems, top, height);
  const links = [];
  const sources = left.bands.filter((item) => item.value > 0);
  const sinks = right.bands.filter((item) => item.value > 0);
  if (sources.length && sinks.length) {
    let sinkIndex = 0;
    let sinkRemain = sinks[0].value;
    const sinkCursor = Object.fromEntries(sinks.map((item) => [item.id, item.y0]));
    const sourceCursor = Object.fromEntries(sources.map((item) => [item.id, item.y0]));
    sources.forEach((source) => {
      let remain = source.value;
      while (remain > 0.001 && sinkIndex < sinks.length) {
        const sink = sinks[sinkIndex];
        const take = Math.min(remain, sinkRemain);
        const sourceSpan = source.y1 - source.y0;
        const sinkSpan = sink.y1 - sink.y0;
        const y1a = sourceCursor[source.id];
        const y2a = sinkCursor[sink.id];
        const y1b = y1a + (take / source.value) * sourceSpan;
        const y2b = y2a + (take / sink.value) * sinkSpan;
        links.push({ from: source.id, to: sink.id, color: sink.color, y1a, y1b, y2a, y2b });
        sourceCursor[source.id] = y1b;
        sinkCursor[sink.id] = y2b;
        remain -= take;
        sinkRemain -= take;
        if (sinkRemain <= 0.001) {
          sinkIndex += 1;
          sinkRemain = sinks[sinkIndex]?.value || 0;
        }
      }
    });
  }
  const spanOf = (bands) => {
    if (!bands.length) return { top, height: 8 };
    return { top: bands[0].y0, height: bands[bands.length - 1].y1 - bands[0].y0 };
  };
  const leftSpan = spanOf(left.bands);
  const rightSpan = spanOf(right.bands);
  return {
    left: [...left.bands, ...left.missing.map((item, index) => ({ ...item, y0: leftSpan.top + leftSpan.height + 16 + index * 16, y1: leftSpan.top + leftSpan.height + 28 + index * 16 }))],
    right: [...right.bands, ...right.missing.map((item, index) => ({ ...item, y0: rightSpan.top + rightSpan.height + 16 + index * 18, y1: rightSpan.top + rightSpan.height + 28 + index * 18 }))],
    links,
    leftTop: leftSpan.top,
    leftHeight: leftSpan.height,
    rightTop: rightSpan.top,
    rightHeight: rightSpan.height,
  };
}

function ribbon(x1, y1a, y1b, x2, y2a, y2b) {
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${y1a} C ${mid} ${y1a}, ${mid} ${y2a}, ${x2} ${y2a} L ${x2} ${y2b} C ${mid} ${y2b}, ${mid} ${y1b}, ${x1} ${y1b} Z`;
}
