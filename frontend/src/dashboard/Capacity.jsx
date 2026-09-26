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

function houseState(share, available, surgeOn) {
  if (surgeOn) return { word: "Surge", tone: "is-surge" };
  if (available === 0 || share >= 85) return { word: "Divert", tone: "is-divert" };
  if (share >= 70) return { word: "Watch", tone: "is-watch" };
  return { word: "Open", tone: "is-open" };
}

function houseNote({ available, total, critical, cleaning, surgeOn, surgeOpen }) {
  if (surgeOn) {
    if (surgeOpen === 0) return "Emergency and ICU have no open beds left for incoming patients.";
    const beds = surgeOpen === 1 ? "bed is" : "beds are";
    return `${surgeOpen} surge ${beds} still open in Emergency and ICU.`;
  }
  if (available === 0) return "No beds are open.";
  const sentence = [`${available} of ${total} beds are open.`];
  if (critical > 0) sentence.push(`${critical} ${critical === 1 ? "is" : "are"} critical.`);
  if (cleaning > 0) sentence.push(`${cleaning} ${cleaning === 1 ? "is" : "are"} still in cleaning.`);
  return sentence.join(" ");
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
  const state = houseState(occupiedShare, model.house.available, surgeOn);
  const stateNote = houseNote({
    available: model.house.available,
    total: model.house.total,
    critical: model.house.critical,
    cleaning: model.house.cleaning,
    surgeOn,
    surgeOpen: model.surgeOpen,
  });

  return (
    <div className="cmd cap">
      <header className={`cap-lead ${state.tone}`}>
        <p className="cap-lead-line">
          <strong>{state.word}</strong>
          <span>{occupiedShare}% full</span>
        </p>
        <p>{stateNote}</p>
      </header>

      <section className="cap-metrics" aria-label="Hospital capacity">
        <div className="cap-hero">
          <span>Open</span>
          <strong>{openBeds}</strong>
          <small>of {model.house.total} census beds</small>
        </div>
        <div className="cap-side">
          <Metric label="Occupancy" value={occupiedShare} suffix="%" />
          <Metric label="Occupied" value={model.house.occupied} />
          <Metric label="Critical" value={model.house.critical} alert={model.house.critical > 0} />
          <Metric label="Cleaning" value={model.house.cleaning} />
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
