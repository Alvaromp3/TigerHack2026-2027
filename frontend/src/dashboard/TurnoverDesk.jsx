import { useMemo, useState } from "react";
import { roomVisualSrc } from "./roomVisuals";

const SHIFT_KEEPERS = [
  { id: "hk-ana", name: "Ana Ruiz", room_id: null },
  { id: "hk-ben", name: "Ben Cole", room_id: null },
  { id: "hk-chris", name: "Chris Adey", room_id: null },
];

const SHIFT_AIDES = [
  { id: "ln-dana", name: "Dana Ibarra", room_id: null },
  { id: "ln-eli", name: "Eli March", room_id: null },
];

const FILTERS = [
  { id: "all", label: "All beds" },
  { id: "stat", label: "STAT" },
  { id: "standard", label: "Standard" },
  { id: "active", label: "Assigned" },
  { id: "linen", label: "Linen" },
];

function nameParts(name) {
  return (name || "").split(" ").filter(Boolean);
}

function shortName(name) {
  const parts = nameParts(name);
  if (parts.length < 2) return name || "—";
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

function shortTime(ticks) {
  if (ticks == null) return null;
  if (ticks <= 0) return "Done";
  const seconds = Math.round(ticks * 9);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.max(1, Math.round(seconds / 60))} min`;
}

function averageTime(rooms) {
  const ticks = rooms.map((room) => room.ticksLeft).filter((value) => value != null && value > 0);
  if (!ticks.length) return "—";
  const total = ticks.reduce((sum, value) => sum + value, 0);
  return shortTime(total / ticks.length);
}

function bedsInTurnover(hospital) {
  const rows = [];
  for (const floor of hospital) {
    for (const room of floor.rooms) {
      if (room.status === "cleaning") rows.push({ ...room, floorName: floor.name, floorId: floor.id });
    }
  }
  return rows;
}

function bedClass(room) {
  if (room.kind === "or") return { key: "or", label: "OR" };
  if (room.floorId === "F1" && room.id.startsWith("ED")) return { key: "f1-ed", label: "ED" };
  if (room.floorId === "F1" && room.id.startsWith("FAST")) return { key: "f1-fast", label: "fast track" };
  if (room.floorId === "F1" && room.id.startsWith("OBS")) return { key: "f1-obs", label: "observation" };
  if (room.floorId === "F3" && room.id.startsWith("ER")) return { key: "f3-er", label: "ER" };
  if (room.dept === "icu") return { key: `icu-${room.floorId}`, label: "ICU" };
  if (room.floorId === "F3" && room.id.startsWith("MS")) return { key: "f3-ms", label: "med/surg" };
  if (room.floorId === "F2" && room.dept === "med") return { key: "f2-med", label: "medicine" };
  if (room.dept === "surgward") return { key: `surg-${room.floorId}`, label: "surgical ward" };
  return { key: `${room.floorId}-${room.dept}`, label: room.deptLabel };
}

function withClass(room, floorId) {
  return { ...room, floorId: room.floorId || floorId };
}

function openInClass(hospital, room) {
  const cls = bedClass(room);
  let open = 0;
  for (const floor of hospital) {
    for (const other of floor.rooms) {
      if (!other.census || other.status !== "available") continue;
      if (bedClass(withClass(other, floor.id)).key === cls.key) open += 1;
    }
  }
  return { ...cls, open };
}

function resolvedType(room, demand) {
  if (room.cleanType === "terminal" || room.cleanType === "stat" || room.cleanType === "standard") {
    return room.cleanType;
  }
  if (room.cleanPriority === 1 || demand) return "stat";
  return "standard";
}

function situation(room, cls) {
  if (room.cleanType === "terminal") return "Isolation clean";
  if (cls.open === 0) return `No open ${cls.label} bed`;
  if (cls.open === 1) return `1 open ${cls.label} bed`;
  return `${cls.open} open ${cls.label} beds`;
}

function linenWord(stage) {
  if (stage === "pickup") return "Pickup";
  if (stage === "wash") return "In wash";
  if (stage === "deliver") return "On the way";
  if (stage === "ready") return "On the bed";
  return null;
}

function trackFor(room) {
  const states = ["done", "wait", "wait", "wait", "wait"];
  if (room.ticksLeft === 0) states[1] = "done";
  else if (room.housekeeper) states[1] = "now";

  const linenAt = { pickup: 2, wash: 3, deliver: 4, ready: 5 }[room.linenStage] ?? 0;
  if (linenAt >= 5) {
    states[2] = "done";
    states[3] = "done";
    states[4] = "done";
  } else if (linenAt > 0) {
    for (let step = 2; step < linenAt; step += 1) states[step] = "done";
    states[linenAt] = "now";
  }

  const names = ["Vacated", "Clean", "Soiled pickup", "Wash", "Deliver"];
  let index = states.lastIndexOf("now");
  if (index < 0) index = states.lastIndexOf("done");
  let caption = names[Math.max(index, 0)];
  if (index === 1 && room.housekeeper) caption = `${caption} · ${shortName(room.housekeeper)}`;
  if (index >= 2 && room.linenAide) caption = `${caption} · ${shortName(room.linenAide)}`;
  if (index <= 0) caption = situation(room, room.cls);
  return { states, caption };
}

function roomById(hospital, id) {
  for (const floor of hospital) {
    const room = floor.rooms.find((item) => item.id === id);
    if (room) return { ...room, floorId: floor.id };
  }
  return null;
}

export default function TurnoverDesk({ hospital, housekeepers, linenAides, movements = [], onOpenRoom }) {
  const [filter, setFilter] = useState("all");
  const keepers = housekeepers.length ? housekeepers : SHIFT_KEEPERS;
  const aides = linenAides.length ? linenAides : SHIFT_AIDES;
  const cleaning = useMemo(() => {
    const rows = bedsInTurnover(hospital).map((room) => {
      const cls = openInClass(hospital, room);
      const cleanType = resolvedType(room, cls.open === 0);
      return { ...room, cls, cleanType };
    });
    rows.sort((a, b) => {
      const rank = { stat: 0, terminal: 1, standard: 2 };
      const byType = (rank[a.cleanType] ?? 3) - (rank[b.cleanType] ?? 3);
      if (byType) return byType;
      return a.id.localeCompare(b.id);
    });
    let queue = 0;
    return rows.map((room) => {
      if (room.housekeeper || room.ticksLeft === 0) return { ...room, queue: null };
      queue += 1;
      return { ...room, queue };
    });
  }, [hospital]);

  const linen = cleaning.filter((room) => ["pickup", "wash", "deliver"].includes(room.linenStage));
  const statCount = cleaning.filter((room) => room.cleanType === "stat").length;
  const standardCount = cleaning.filter((room) => room.cleanType === "standard").length;
  const assigned = cleaning.filter((room) => room.housekeeper);
  const counts = {
    all: cleaning.length,
    stat: statCount,
    standard: standardCount,
    active: assigned.length,
    linen: linen.length,
  };
  const shown = cleaning.filter((room) => {
    if (filter === "stat") return room.cleanType === "stat";
    if (filter === "standard") return room.cleanType === "standard";
    if (filter === "active") return Boolean(room.housekeeper);
    if (filter === "linen") return ["pickup", "wash", "deliver"].includes(room.linenStage);
    return true;
  });
  const opened = useMemo(
    () => (movements || [])
      .filter((event) => event.kind === "clean" && String(event.message || "").includes(" is open"))
      .slice(0, 6),
    [movements],
  );
  const idleKeepers = keepers.filter((person) => !person.room_id).length;

  return (
    <section className="turn-desk" aria-label="Bed turnover">
      <header className="turn-top">
        <div className="turn-hero-copy">
          <p className="kicker">Housekeeping</p>
          <h2>Bed turnover</h2>
          <p>A bed stays closed until the room is clean and fresh linen is on it.</p>
        </div>
        <div className="turn-metrics">
          <article>
            <span>In queue</span>
            <strong>{cleaning.length}</strong>
          </article>
          <article className="is-stat">
            <span>STAT</span>
            <strong>{statCount}</strong>
          </article>
          <article>
            <span>Standard</span>
            <strong>{standardCount}</strong>
          </article>
          <article>
            <span>Average</span>
            <strong>{averageTime(cleaning)}</strong>
          </article>
        </div>
      </header>

      <div className="turn-crew" aria-label="Crew">
        <p>
          <span>Housekeeping</span>
          {keepers.map((person) => (
            <em key={person.id}>{person.name} · {person.room_id || "Idle"}</em>
          ))}
        </p>
        <p>
          <span>Linen</span>
          {aides.map((person) => {
            const room = cleaning.find((item) => item.id === person.room_id);
            const stage = room ? linenWord(room.linenStage) : null;
            return (
              <em key={person.id}>
                {person.name} · {person.room_id ? `${person.room_id}${stage ? ` · ${stage}` : ""}` : "Idle"}
              </em>
            );
          })}
        </p>
      </div>

      {opened.length > 0 && (
        <p className="turn-recent">
          <span>Opened</span>
          {opened.map((event) => {
            const room = roomById(hospital, event.room_id);
            return (
              <button
                key={event.id}
                type="button"
                onClick={() => room && onOpenRoom(room.floorId, room.id)}
              >
                {event.room_id}
              </button>
            );
          })}
        </p>
      )}

      <div className="turn-filters" role="tablist" aria-label="Turnover filter">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            className={filter === item.id ? "is-on" : ""}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
            <b>{counts[item.id]}</b>
          </button>
        ))}
      </div>

      {shown.length === 0 && <p className="turn-empty">No beds in this view.</p>}

      {shown.length > 0 && (
        <div className="turn-sheet">
          <div className="turn-head">
            <span>Room</span>
            <span>Progress</span>
            <span>Wait</span>
            <span>Action</span>
          </div>
          {shown.map((room) => {
            const track = trackFor(room);
            const working = Boolean(room.housekeeper) || ["pickup", "wash", "deliver"].includes(room.linenStage);
            const time = shortTime(room.ticksLeft);
            const behind = room.cleanType === "stat" || (room.queue != null && room.queue > idleKeepers);
            const wait = time || (room.queue != null && room.queue <= idleKeepers ? "Next" : room.queue ? `Queue ${room.queue}` : "—");
            const edge = working ? "is-live" : behind ? "is-wait" : "";
            return (
              <button
                key={room.id}
                type="button"
                className={edge ? `turn-row ${edge}` : "turn-row"}
                onClick={() => onOpenRoom(room.floorId, room.id)}
              >
                <span className="turn-room">
                  <img src={roomVisualSrc(room)} alt="" />
                  <span>
                    <strong>{room.id}</strong>
                    <small>{room.deptLabel}</small>
                  </span>
                </span>
                <span className="turn-progress">
                  <span className="turn-track" aria-hidden="true">
                    {track.states.map((state, index) => (
                      <span key={state + index}>
                        {index > 0 && <i className={track.states[index - 1] === "done" ? "is-done" : ""} />}
                        <b className={`is-${state}`} />
                      </span>
                    ))}
                  </span>
                  <small>{track.caption}</small>
                </span>
                <span className={behind && !working ? "turn-wait is-late" : "turn-wait"}>{wait}</span>
                <span className={working ? "turn-action" : "turn-action is-open"}>
                  {working ? "In progress" : "Open"}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
