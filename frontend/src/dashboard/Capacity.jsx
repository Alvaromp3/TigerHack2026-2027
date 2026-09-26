import { useEffect, useMemo, useRef, useState } from "react";
import { DEPT } from "./floors";

const MIX = {
  critical: "var(--plot-critical)",
  stable: "var(--plot-stable)",
  cleaning: "var(--plot-cleaning)",
  available: "var(--plot-open)",
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

function toneClass(share) {
  if (share >= 85) return "is-red";
  if (share >= 70) return "is-amber";
  return "";
}

function formatTurnoverTime(roomCount, minutesPerRoom = 15) {
  const totalMins = roomCount * minutesPerRoom;
  if (totalMins === 0) return "0m";
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours === 0) return `~${mins} min`;
  if (mins === 0) return `~${hours} hr`;
  return `~${hours}h ${mins}m est.`;
}

function DonutGauge({ share, available }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(share, 100) / 100) * circumference;

  let strokeColor = "#10b981"; // Nominal green
  if (share >= 85) strokeColor = "#ef4444"; // Red saturation
  else if (share >= 70) strokeColor = "#d97706"; // Amber watch

  return (
    <div className="donut-wrap">
      <svg className="donut-svg" viewBox="0 0 100 100" width="105" height="105">
        <circle
          className="donut-bg"
          cx="50"
          cy="50"
          r={radius}
          strokeWidth="8"
        />
        <circle
          className="donut-fill"
          cx="50"
          cy="50"
          r={radius}
          strokeWidth="8"
          stroke={strokeColor}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="donut-inner">
        <strong>{available}</strong>
        <span>OPEN</span>
      </div>
    </div>
  );
}

function evaluateDirective(model, surgeOn) {
  if (surgeOn) {
    return {
      tone: "is-surge",
      word: "Surge",
      badge: "SURGE ACTIVE",
      message: "Emergency surge operations active.",
      directive: `Prioritize intake; ${model.surgeOpen} surge beds ready in critical zones.`
    };
  }

  const ed = model.units.find((u) => u.id === "ed");
  const icu = model.units.find((u) => u.id === "icu");
  const or = model.units.find((u) => u.id === "or");

  // Priority 1: Emergency Department bottleneck
  if (ed && (pct(ed.occupied, ed.total) >= 80 || ed.available <= 3)) {
    const edShare = pct(ed.occupied, ed.total);
    const isCritical = edShare >= 90 || ed.available <= 1;
    return {
      tone: isCritical ? "is-divert" : "is-watch",
      word: isCritical ? "Divert" : "Watch",
      badge: "ED CONSTRAINED",
      message: `Emergency at ${edShare}% capacity (${ed.available} beds open).`,
      directive: "Reroute non-emergent walk-ins to urgent care; initiate fast-track triage."
    };
  }

  // Priority 2: ICU saturation
  if (icu && (pct(icu.occupied, icu.total) >= 80 || icu.available <= 2)) {
    const icuShare = pct(icu.occupied, icu.total);
    const isCritical = icuShare >= 90 || icu.available <= 1;
    return {
      tone: isCritical ? "is-divert" : "is-watch",
      word: isCritical ? "Divert" : "Watch",
      badge: "ICU CONSTRAINED",
      message: `Intensive Care at ${icuShare}% capacity (${icu.available} beds open).`,
      directive: "Review step-down candidates for general wards; hold elective surgical intake."
    };
  }

  // Priority 3: OR backlog
  if (or && pct(or.occupied, or.total) >= 85) {
    return {
      tone: "is-watch",
      word: "Watch",
      badge: "OR CONSTRAINED",
      message: `Surgical suites at ${pct(or.occupied, or.total)}% utilization.`,
      directive: "Expedite post-anesthesia transfers to open surgical recovery beds."
    };
  }

  // Priority 4: Turnover / Housekeeping delays
  if (model.house.cleaning >= 8) {
    return {
      tone: "is-watch",
      word: "Watch",
      badge: "TURNOVER DELAY",
      message: `${model.house.cleaning} pending bed cleanings delaying intake.`,
      directive: "Reassign environmental services priority to Floor 1 trauma suites."
    };
  }

  // Priority 5: Hospital-wide census thresholds
  const overallShare = pct(model.house.occupied, model.house.total);
  if (overallShare >= 85) {
    return {
      tone: "is-divert",
      word: "Divert",
      badge: "HOSPITAL SATURATION",
      message: `Total facility census reached ${overallShare}%.`,
      directive: "Enact early-discharge triage; alert EMS dispatch of pending divert."
    };
  }

  if (overallShare >= 70) {
    return {
      tone: "is-watch",
      word: "Watch",
      badge: "INPATIENT DEFICIT",
      message: `Hospital-wide census at ${overallShare}%.`,
      directive: "Accelerate step-down discharges and monitor bed availability across floors."
    };
  }

  // Default: Optimal / Nominal
  return {
    tone: "is-open",
    word: "Nominal",
    badge: "UNITS CLEAR",
    message: "All receiving units operating within standard capacity.",
    directive: "Intake flow open across all services; routine census monitoring."
  };
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

function codesFor(hospital, match) {
  return hospital
    .filter((floor) => floor.rooms.some((room) => room.census && match(room)))
    .map((floor) => floor.code)
    .sort((a, b) => floorRank(a) - floorRank(b));
}

export default function Capacity({ hospital, surgeOn, activeFloorId, onOpenFloor }) {
  const model = useMemo(() => {
    const rooms = hospital.flatMap((floor) => floor.rooms);
    const house = tally(rooms);
    const floors = hospital
      .map((floor) => ({
        ...tally(floor.rooms),
        id: floor.id,
        code: floor.code,
        name: floor.name,
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

    const icuRooms = rooms.filter((room) => room.dept === "icu");
    const edRooms = rooms.filter((room) => room.dept === "ed" || room.dept === "trauma");
    const orRooms = rooms.filter((room) => room.kind === "or");
    const surgeBeds = (list) => list.filter((room) => room.census && room.surge && room.status === "available").length;

    return {
      house,
      floors,
      departments,
      units: [
        {
          id: "icu",
          label: "Intensive Care",
          where: codesFor(hospital, (room) => room.dept === "icu").join(" · ") || "—",
          ...tally(icuRooms),
          surge: surgeBeds(icuRooms),
        },
        {
          id: "ed",
          label: "Emergency",
          where: codesFor(hospital, (room) => room.dept === "ed" || room.dept === "trauma").join(" · ") || "—",
          ...tally(edRooms),
          surge: surgeBeds(edRooms),
        },
        {
          id: "or",
          label: "Operating rooms",
          where: codesFor(hospital, (room) => room.kind === "or").join(" · ") || "—",
          ...tally(orRooms),
          surge: null,
        },
      ],
      surgeOpen: surgeBeds([...icuRooms, ...edRooms]),
    };
  }, [hospital]);

  const occupiedShare = pct(model.house.occupied, model.house.total);
  const openBeds = useCount(model.house.available);
  const directive = evaluateDirective(model, surgeOn);

  return (
    <div className="cmd cap">
      <header className={`cap-lead ${directive.tone}`}>
        <div className="cap-lead-status">
          <span className="status-indicator-dot" />
          <strong className="cap-lead-word">{directive.word}</strong>
        </div>
        <div className="cap-lead-message">
          <span className="cap-badge">{directive.badge}</span>
          <span className="cap-message-text">{directive.message}</span>
          <span className="cap-separator" aria-hidden="true" />
          <span className="cap-directive-wrap">
            <span className="cap-directive-label">DIRECTIVE:</span>
            <span className="cap-directive-text">{directive.directive}</span>
          </span>
        </div>
      </header>

      <section className="cap-metrics-grid" aria-label="Hospital capacity metrics">
        {/* Zone 1: Census Hero Block */}
        <div className="cap-metric-card cap-hero-card">
          <DonutGauge share={occupiedShare} available={openBeds} />
          <div className="cap-hero-details">
            <span className="cap-card-kicker">FACILITY CENSUS</span>
            <div className="cap-hero-stats">
              <p className="cap-hero-main-stat">
                <strong>{model.house.occupied}</strong>
                <span>/ {model.house.total} occupied</span>
                <b className="cap-hero-pct">({occupiedShare}%)</b>
              </p>
              <p className="cap-hero-sub-stat">
                <span className="surge-indicator-icon">+</span>
                <strong>{model.surgeOpen}</strong> emergency surge beds available
              </p>
            </div>
          </div>
        </div>

        {/* Zone 2: Patient Acuity Card */}
        <div className={`cap-metric-card cap-acuity-card ${model.house.critical > 0 ? "is-critical-alert" : "is-stable"}`}>
          <div className="cap-card-header">
            <span className="cap-card-kicker">CLINICAL ACUITY</span>
            <span className="cap-card-pill">
              {model.house.critical > 0 ? "HIGH ATTENTION" : "STABLE"}
            </span>
          </div>
          <div className="cap-card-body">
            {model.house.critical === 0 ? (
              <div className="cap-status-callout">
                <span className="cap-status-icon">✓</span>
                <div>
                  <strong>All Patients Stable</strong>
                  <p>Zero active critical monitoring flags</p>
                </div>
              </div>
            ) : (
              <div className="cap-status-callout">
                <strong className="cap-critical-count">{model.house.critical}</strong>
                <div>
                  <span className="cap-critical-label">Critical Holds</span>
                  <p>ICU / Trauma acuity alert active</p>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Zone 3: Bed Turnover Pipeline Card */}
        <div className={`cap-metric-card cap-turnover-card ${model.house.cleaning > 0 ? "is-active" : "is-idle"}`}>
          <div className="cap-card-header">
            <span className="cap-card-kicker">BED TURNOVER</span>
            <span className="cap-card-pill">
              {model.house.cleaning > 0 ? `${model.house.cleaning} QUEUED` : "IDLE"}
            </span>
          </div>
          <div className="cap-card-body">
            {model.house.cleaning === 0 ? (
              <div className="cap-status-callout">
                <span className="cap-status-icon">✓</span>
                <div>
                  <strong>Queue Clear</strong>
                  <p>No turnover delays reported by EVS</p>
                </div>
              </div>
            ) : (
              <div className="cap-status-callout">
                <strong className="cap-turnover-count">{model.house.cleaning}</strong>
                <div>
                  <span className="cap-turnover-label">Rooms in Cleaning</span>
                  <p className="cap-turnover-time">{formatTurnoverTime(model.house.cleaning)}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="cap-units" aria-label="Receiving units">
        {model.units.map((unit) => (
          <Unit key={unit.id} unit={unit} />
        ))}
      </section>

      <section className="cap-split">
        <div>
          <h3>Floors</h3>
          <p className="overview-sub">Select a floor to open it on the map.</p>
          <div className="cap-scroll">
            <div className="cap-sheet" role="table" aria-label="Capacity by floor">
              <div className="cap-row cap-head" role="row">
                <span role="columnheader">Floor</span>
                <span role="columnheader">Open</span>
                <span role="columnheader">Occupied</span>
                <span role="columnheader">Critical</span>
                <span role="columnheader">Cleaning</span>
                <span role="columnheader">Total</span>
                <span role="columnheader">Occupancy</span>
              </div>
              {model.floors.map((floor) => {
                const share = pct(floor.occupied, floor.total);
                return (
                  <button
                    key={floor.id}
                    type="button"
                    role="row"
                    className={floor.id === activeFloorId ? "cap-row is-on" : "cap-row"}
                    onClick={() => onOpenFloor(floor.id)}
                  >
                    <span className="cap-floor" role="cell">
                      <em>{floor.code}</em>
                      {floor.name}
                    </span>
                    <strong role="cell">{floor.available}</strong>
                    <span role="cell">{floor.occupied}</span>
                    <span role="cell" className={floor.critical > 0 ? "is-alert" : ""}>{floor.critical}</span>
                    <span role="cell">{floor.cleaning}</span>
                    <span role="cell">{floor.total}</span>
                    <span className="cap-occ" role="cell">
                      <Meter share={share} />
                      <b>{share}%</b>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div>
          <h3>Departments</h3>
          <p className="overview-sub">Tightest units first. The figure is open beds.</p>
          {model.departments.length === 0 ? (
            <p className="cmd-empty">No census beds.</p>
          ) : (
            <ul className="cap-depts">
              {model.departments.map((dept) => {
                const share = pct(dept.occupied, dept.total);
                return (
                  <li key={dept.id}>
                    <span>{dept.label}</span>
                    <div>
                      <div
                        className="cap-stack"
                        title={`${dept.occupied} occupied of ${dept.total}`}
                      >
                        <i style={{ width: `${(dept.critical / dept.total) * 100}%`, background: MIX.critical }} />
                        <i style={{ width: `${(dept.stable / dept.total) * 100}%`, background: MIX.stable }} />
                        <i style={{ width: `${(dept.cleaning / dept.total) * 100}%`, background: MIX.cleaning }} />
                        <i style={{ width: `${(dept.available / dept.total) * 100}%`, background: MIX.available }} />
                      </div>
                      <small>{share}% occupied</small>
                    </div>
                    <strong>{dept.available}</strong>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value, suffix = "", alert = false }) {
  const shown = useCount(value);
  return (
    <div className={alert ? "is-alert" : ""}>
      <span>{label}</span>
      <strong>{shown}{suffix}</strong>
    </div>
  );
}

function Unit({ unit }) {
  const open = useCount(unit.available);
  const share = pct(unit.occupied, unit.total);
  return (
    <article className="cap-unit">
      <p className="kicker">{unit.label}</p>
      <strong>{open}</strong>
      <span>open</span>
      <Meter share={share} />
      <p>{unit.occupied} of {unit.total} in use · {unit.where}</p>
      {unit.surge != null && (
        <p>{unit.surge} surge {unit.surge === 1 ? "bed" : "beds"} still open</p>
      )}
    </article>
  );
}

function Meter({ share }) {
  return (
    <span className="cap-track" aria-hidden="true">
      <i className="cap-mark" style={{ left: "70%" }} />
      <i className="cap-mark is-limit" style={{ left: "85%" }} />
      <i className={`cap-bar ${toneClass(share)}`} style={{ width: `${share}%` }} />
    </span>
  );
}
