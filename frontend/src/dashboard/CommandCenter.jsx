import { useEffect, useMemo, useState } from "react";
import LoginButton from "../auth/LoginButton";
import ElevatorPanel from "./ElevatorPanel";
import FloorPlan from "./FloorPlan";
import {
  FRAME,
  STATUS,
  applySurge,
  buildHospital,
  findRooms,
  summarize,
} from "./floors";
import "./dashboard.css";

const NAV = [
  { id: "live", label: "Live Map", icon: "map" },
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "capacity", label: "Capacity", icon: "bed" },
  { id: "flow", label: "Patient Flow", icon: "flow" },
  { id: "equipment", label: "Equipment", icon: "plug" },
  { id: "turnover", label: "Bed turnover", icon: "broom" },
  { id: "staff", label: "Staff", icon: "users" },
  { id: "incidents", label: "Incidents", icon: "alert" },
  { id: "reports", label: "Reports", icon: "chart" },
  { id: "settings", label: "Settings", icon: "gear" },
];

const NOTES = {
  overview: "Census for this floor is the card on the left. The plate stays on screen.",
  capacity: "Open beds are the available count. Surge fills Emergency and ICU first.",
  flow: "Patient flow follows the bed state on the plate: critical, warning, stable, open, cleaning.",
  equipment: "Monitors, vents, and pumps sit on the selected bed. Pick a room to read them.",
  turnover: "Purple beds are in cleaning. They are not free until housekeeping marks them ready.",
  staff: "Each occupied bed shows the attending and the primary nurse. The charge nurse covers the unit.",
  reports: "Reports stay off this demo. The live plate is the operational view.",
  settings: "Settings stay off this demo. Floor maps and the elevator are local.",
  three: "3D is off. This command view is the measured 2D plate.",
};

function Icon({ name }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  };
  if (name === "map") {
    return (
      <svg {...common}>
        <path d="M4 6.5 9.2 4l5.6 2.4L20 4.2V17.5l-5.2 2.3-5.6-2.4L4 19.6V6.5z" />
        <path d="M9.2 4v13.4M14.8 6.4V19.8" />
      </svg>
    );
  }
  if (name === "grid") {
    return (
      <svg {...common}>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1.2" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1.2" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1.2" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1.2" />
      </svg>
    );
  }
  if (name === "bed") {
    return (
      <svg {...common}>
        <path d="M3 18V9.5A1.5 1.5 0 0 1 4.5 8H8a2.5 2.5 0 0 1 2.5 2.5V13" />
        <path d="M3 13h18v5M3 18h18" />
        <path d="M21 18v-5.5A2.5 2.5 0 0 0 18.5 10H10" />
      </svg>
    );
  }
  if (name === "flow") {
    return (
      <svg {...common}>
        <path d="M4 7h16M4 12h16M4 17h16" />
      </svg>
    );
  }
  if (name === "plug") {
    return (
      <svg {...common}>
        <path d="M12 7v5" />
        <path d="M7.5 9.2a6.2 6.2 0 1 0 9 0" />
      </svg>
    );
  }
  if (name === "broom") {
    return (
      <svg {...common}>
        <path d="M12 20h7" />
        <path d="m14.6 6.2 3.2 3.2" />
        <path d="M16.4 3.4a1.9 1.9 0 0 1 2.7 2.7L8.4 17 4 18.2 5.2 14 16.4 3.4z" />
      </svg>
    );
  }
  if (name === "users") {
    return (
      <svg {...common}>
        <circle cx="12" cy="8" r="3.2" />
        <path d="M5.2 20v-1.1A4.8 4.8 0 0 1 10 14.1h4a4.8 4.8 0 0 1 4.8 4.8V20" />
      </svg>
    );
  }
  if (name === "alert") {
    return (
      <svg {...common}>
        <path d="M12 4 20.5 19h-17L12 4z" />
        <path d="M12 10v4.2M12 17.2h.01" />
      </svg>
    );
  }
  if (name === "chart") {
    return (
      <svg {...common}>
        <path d="M5 19V5M5 19h14" />
        <path d="M9 16v-4M13 16V8M17 16v-2" />
      </svg>
    );
  }
  if (name === "gear") {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2.8v2.2M12 19v2.2M2.8 12h2.2M19 12h2.2M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M18.9 5.1l-1.6 1.6M6.7 17.3l-1.6 1.6" />
      </svg>
    );
  }
  if (name === "search") {
    return (
      <svg {...common}>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3-3" />
      </svg>
    );
  }
  if (name === "bell") {
    return (
      <svg {...common}>
        <path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4l2-2z" />
        <path d="M10 19a2 2 0 0 0 4 0" />
      </svg>
    );
  }
  return null;
}

function equipmentFor(room) {
  if (!room?.census) return [];
  const busy = room.status === "critical" || room.status === "warning" || room.status === "normal";
  const rows = [
    { name: "Patient monitor", state: room.status === "cleaning" ? "Cleaning" : "Operational" },
    { name: "Infusion pump", state: room.status === "cleaning" ? "Cleaning" : "Operational" },
    { name: "Bedside oxygen", state: "Operational" },
  ];
  if (room.dept === "icu" || room.dept === "trauma" || room.status === "critical") {
    rows.splice(1, 0, {
      name: "Ventilator",
      state: busy ? "Operational" : "Standby",
    });
  }
  if (room.kind === "or") {
    return [
      { name: "Anesthesia machine", state: room.status === "available" ? "Standby" : "Operational" },
      { name: "Surgical table", state: "Operational" },
      { name: "Overhead lights", state: "Operational" },
    ];
  }
  return rows;
}

function Stat({ tone, label, value }) {
  return (
    <div className="stat">
      <span className={`stat-dot ${tone}`} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

export default function CommandCenter() {
  const [hospital, setHospital] = useState(() => buildHospital());
  const [floorId, setFloorId] = useState("F3");
  const [selectedId, setSelectedId] = useState("ICU-304");
  const [hover, setHover] = useState(null);
  const [deptFilter, setDeptFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [nav, setNav] = useState("live");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [note, setNote] = useState(null);
  const [elevatorOpen, setElevatorOpen] = useState(false);
  const [surgeOn, setSurgeOn] = useState(false);
  const [badge, setBadge] = useState(1);
  const [bellOpen, setBellOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  const [showBeds, setShowBeds] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [zoom, setZoom] = useState(1.25);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [tab, setTab] = useState("overview");
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(() => new Date());

  const floor = hospital.find((level) => level.id === floorId) || hospital[2];
  const summary = useMemo(() => summarize(floor), [floor]);
  const selected = floor.rooms.find((room) => room.id === selectedId) || null;
  const hits = useMemo(() => findRooms(hospital, query), [hospital, query]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    function onKey(event) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.getElementById("map-search")?.focus();
      }
      if (event.key === "Escape") {
        setElevatorOpen(false);
        setSearchOpen(false);
        setBellOpen(false);
        setLayersOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function frameRoom(room, nextZoom = zoom) {
    const viewW = FRAME.w / nextZoom;
    const viewH = FRAME.h / nextZoom;
    setPan({
      x: room.x + room.w / 2 - viewW / 2 - FRAME.x,
      y: room.y + room.h / 2 - viewH / 2 - FRAME.y,
    });
  }

  function goToFloor(id) {
    setFloorId(id);
    setSelectedId(null);
    setDeptFilter("all");
    setElevatorOpen(false);
    setHover(null);
    setPan({ x: 0, y: 0 });
    setNote(null);
    if (nav !== "incidents") setNav("live");
  }

  function openHit(hit) {
    setFloorId(hit.floor.id);
    setSelectedId(hit.room.id);
    setDeptFilter("all");
    setNav("live");
    setNote(null);
    setElevatorOpen(false);
    setSearchOpen(false);
    setQuery(hit.room.id);
    setTab("overview");
    frameRoom(hit.room);
  }

  function chooseNav(id) {
    setNav(id);
    setElevatorOpen(false);
    if (id === "incidents") {
      setNote(null);
      return;
    }
    if (id === "live") {
      setNote(null);
      return;
    }
    setNote(NOTES[id]);
  }

  function declareSurge() {
    if (surgeOn) return;
    const { hospital: next, flipped } = applySurge(hospital);
    setHospital(next);
    setSurgeOn(true);
    setBadge(3);
    setNav("incidents");
    setToast(
      flipped
        ? `${flipped} open beds on F1 and F3 are now held for the train collision.`
        : "No open surge beds left on F1 or F3.",
    );
  }

  function changeZoom(direction) {
    const next = Math.min(3.6, Math.max(0.8, zoom * (direction > 0 ? 1.15 : 0.87)));
    const cx = FRAME.x + pan.x + FRAME.w / zoom / 2;
    const cy = FRAME.y + pan.y + FRAME.h / zoom / 2;
    const viewW = FRAME.w / next;
    const viewH = FRAME.h / next;
    setZoom(next);
    setPan({ x: cx - viewW / 2, y: cy - viewH / 2 });
  }

  const deptBeds = selected
    ? floor.rooms.filter((room) => room.census && room.dept === selected.dept)
    : [];
  const deptOccupied = deptBeds.filter((room) =>
    ["critical", "warning", "normal"].includes(room.status),
  ).length;
  const occPct = deptBeds.length ? Math.round((deptOccupied / deptBeds.length) * 100) : 0;
  const clock = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const dateLabel = now.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const rightOpen = Boolean(selected) || nav === "incidents" || Boolean(note);

  function placeNavTip(event) {
    const tip = event.currentTarget.querySelector(".nav-tip");
    if (!tip) return;
    const rect = event.currentTarget.getBoundingClientRect();
    tip.style.top = `${rect.top + rect.height / 2}px`;
    tip.style.left = `${rect.right + 14}px`;
  }

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="cross" aria-hidden="true">
            +
          </span>
          <div>
            <strong>Tiger Memorial Hospital</strong>
            <small>SURGE COMMAND</small>
          </div>
        </div>

        <div className="search-wrap">
          <Icon name="search" />
          <input
            id="map-search"
            value={query}
            placeholder="Search room, department, or patient"
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            aria-label="Search the hospital"
          />
          <kbd>⌘K</kbd>
          {searchOpen && query.trim() && (
            <div className="search-pop">
              {hits.length === 0 && <p className="muted">No match on any floor.</p>}
              {hits.map((hit) => (
                <button key={`${hit.floor.id}-${hit.room.id}`} type="button" onClick={() => openHit(hit)}>
                  <strong>{hit.room.id}</strong>
                  <span>
                    {hit.floor.code} · {hit.room.deptLabel}
                    {hit.room.patient ? ` · ${hit.room.patient}` : ""}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="top-tools">
          <div className="bell-wrap">
            <button
              type="button"
              className="icon-btn"
              aria-label="Alerts"
              onClick={() => setBellOpen((open) => !open)}
            >
              <Icon name="bell" />
              <em>{badge}</em>
            </button>
            {bellOpen && (
              <div className="bell-pop">
                <strong>Train collision — MCI</strong>
                <p>Rail incident. Emergency and ICU are the receiving units.</p>
              </div>
            )}
          </div>
          <LoginButton />
          <div className="clock">
            <span>{dateLabel}</span>
            <strong>{clock}</strong>
          </div>
        </div>
      </header>

      <div className={navCollapsed ? "workspace is-slim" : "workspace"}>
        <aside className={navCollapsed ? "nav is-collapsed" : "nav"}>
          <div className="nav-head">
            <span className="nav-mark" aria-hidden="true">
              +
            </span>
            <strong>Tiger</strong>
            <button
              type="button"
              className="nav-collapse"
              aria-label={navCollapsed ? "Expand sidebar" : "Minimize sidebar"}
              aria-expanded={!navCollapsed}
              onClick={() => setNavCollapsed((open) => !open)}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d={navCollapsed ? "M8 6l5 6-5 6M13 6l5 6-5 6" : "M16 6l-5 6 5 6M11 6l-5 6 5 6"}
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          <div className="nav-list">
            {NAV.map((item) => (
              <button
                key={item.id}
                type="button"
                className={nav === item.id ? "nav-btn is-on" : "nav-btn"}
                onClick={() => chooseNav(item.id)}
                onMouseEnter={placeNavTip}
                onFocus={placeNavTip}
              >
                <Icon name={item.icon} />
                <span className="nav-label">{item.label}</span>
                {item.id === "incidents" && <em className="nav-badge">{badge}</em>}
                <span className="nav-tip">{item.label}</span>
              </button>
            ))}
          </div>

          <div className="campus">
            <div className="campus-copy">
              <img src="/main-hospital.jpg" alt="Main Hospital" />
              <strong>Main Hospital</strong>
            </div>
            <div className="campus-floors" role="group" aria-label="Floors">
              {hospital.map((level) => (
                <button
                  key={level.id}
                  type="button"
                  className={level.id === floor.id ? "floor-chip is-on" : "floor-chip"}
                  aria-pressed={level.id === floor.id}
                  aria-label={level.name}
                  onClick={() => goToFloor(level.id)}
                  onMouseEnter={placeNavTip}
                  onFocus={placeNavTip}
                >
                  {level.code}
                  <span className="nav-tip">{level.name}</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <main className="stage">
          <div className="toolbar">
            <button type="button" className="tool-select" disabled>
              Main Hospital
            </button>
            <label className="tool-select">
              <span className="sr">Floor</span>
              <select value={floor.id} onChange={(event) => goToFloor(event.target.value)} aria-label="Floor">
                {hospital.map((level) => (
                  <option key={level.id} value={level.id}>
                    {level.name} — {level.subtitle}
                  </option>
                ))}
              </select>
            </label>
            <label className="tool-select">
              <span className="sr">Department</span>
              <select
                value={deptFilter}
                onChange={(event) => setDeptFilter(event.target.value)}
                aria-label="Department"
              >
                <option value="all">All departments</option>
                {summary.departments.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="mode">
              <button type="button" className="is-on">
                2D
              </button>
              <button
                type="button"
                onClick={() => {
                  setNav("settings");
                  setNote(NOTES.three);
                  setElevatorOpen(false);
                }}
              >
                3D
              </button>
            </div>
            <div className="layers-wrap">
              <button type="button" className="tool-select" onClick={() => setLayersOpen((open) => !open)}>
                Layers
              </button>
              {layersOpen && (
                <div className="layers-pop">
                  <label>
                    <input type="checkbox" checked={showBeds} onChange={() => setShowBeds((v) => !v)} />
                    Beds and status
                  </label>
                  <label>
                    <input type="checkbox" checked={showLabels} onChange={() => setShowLabels((v) => !v)} />
                    Room names
                  </label>
                </div>
              )}
            </div>
          </div>

          <div
            className={rightOpen ? "map-stage has-detail" : "map-stage"}
            onClick={() => {
              setSearchOpen(false);
              setBellOpen(false);
            }}
          >
            <aside className="overview">
              <h2>{floor.name} overview</h2>
              <p className="overview-sub">{floor.subtitle}</p>
              <Stat tone="slate" label="Total beds" value={summary.total} />
              <Stat tone="teal" label="Available" value={summary.available} />
              <Stat tone="amber" label="Occupied" value={summary.occupied} />
              <Stat tone="red" label="Critical" value={summary.critical} />
              <Stat tone="violet" label="Cleaning" value={summary.cleaning} />

              <h3>Departments</h3>
              <ul className="dept-list">
                {summary.departments.map((dept) => (
                  <li key={dept.id}>
                    <i style={{ background: dept.color }} />
                    <span>{dept.label}</span>
                    <strong>{dept.beds || dept.rooms}</strong>
                  </li>
                ))}
              </ul>

              <h3>Amenities</h3>
              <ul className="dept-list amenity-list">
                {summary.amenities.map((item) => (
                  <li key={item.id}>
                    <span>{item.label}</span>
                    <strong>{item.count}</strong>
                  </li>
                ))}
              </ul>
            </aside>

            <div className="map-canvas">
            <FloorPlan
              floor={floor}
              deptFilter={deptFilter}
              selectedId={selectedId}
              showBeds={showBeds}
              showLabels={showLabels}
              zoom={zoom}
              pan={pan}
              elevatorOpen={elevatorOpen}
              onPanZoom={(nextPan, nextZoom) => {
                setPan(nextPan);
                setZoom(nextZoom);
              }}
              onSelect={(id) => {
                setSelectedId(id);
                setNav("live");
                setNote(null);
                setTab("overview");
              }}
              onHover={setHover}
              onElevator={() => setElevatorOpen(true)}
              onStair={() => setToast("Stairs stay on this floor. Use the elevator to change maps.")}
            />

            <div className="zoom-tools">
              <button type="button" onClick={() => changeZoom(1)} aria-label="Zoom in">
                +
              </button>
              <button type="button" onClick={() => changeZoom(-1)} aria-label="Zoom out">
                −
              </button>
            </div>
            <div className="legend">
              <span><i className="lg lg-elev" /> Elevator</span>
              <span><i className="lg lg-stair" /> Staircase</span>
              <span><i className="lg lg-wc" /> Lavatory</span>
            </div>
            {elevatorOpen && (
              <ElevatorPanel
                floors={hospital}
                currentId={floor.id}
                onSelect={goToFloor}
                onClose={() => setElevatorOpen(false)}
              />
            )}
            {toast && (
              <button type="button" className="toast" onClick={() => setToast("")}>
                {toast}
              </button>
            )}
            </div>

            {rightOpen && (
              <aside className="detail">
                {nav === "incidents" && (
                  <div className="incident">
                    <div className="detail-head">
                      <div>
                        <p className="kicker">Active incident</p>
                        <h2>Train collision — MCI</h2>
                      </div>
                      <button type="button" className="icon-btn" onClick={() => setNav("live")} aria-label="Close">
                        ×
                      </button>
                    </div>
                    <p>
                      A rail incident is sending critical patients here. Surge holds every open bed in
                      the Emergency Department on F1 and the ICU on F3.
                    </p>
                    <button type="button" className="surge-btn" onClick={declareSurge} disabled={surgeOn}>
                      {surgeOn ? "Surge declared" : "Declare surge"}
                    </button>
                    {surgeOn && (
                      <p className="surge-note">
                        Receiving units updated. Ride the elevator to F1 or F3 to see the beds turn critical.
                      </p>
                    )}
                  </div>
                )}

                {nav !== "incidents" && note && (
                  <div className="incident">
                    <div className="detail-head">
                      <h2>Live map</h2>
                      <button type="button" className="icon-btn" onClick={() => { setNote(null); setNav("live"); }} aria-label="Close">
                        ×
                      </button>
                    </div>
                    <p>{note}</p>
                  </div>
                )}

                {nav !== "incidents" && !note && selected && (
                  <RoomCard
                    room={selected}
                    floor={floor}
                    tab={tab}
                    onTab={setTab}
                    occPct={occPct}
                    deptBeds={deptBeds}
                    onClose={() => setSelectedId(null)}
                  />
                )}
              </aside>
            )}

            {hover && (
              <div className="tip" style={{ left: hover.x + 14, top: hover.y + 14 }}>
                <strong>{hover.room.id}</strong>
                <span>
                  {hover.room.census ? "1 bed · " : ""}
                  {hover.room.status ? STATUS[hover.room.status].label : hover.room.type}
                </span>
                <small>
                  {hover.room.deptLabel} · {floor.name}
                </small>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

function RoomCard({ room, floor, tab, onTab, occPct, deptBeds, onClose }) {
  const gear = equipmentFor(room);
  const critical = deptBeds.filter((item) => item.status === "critical").length;
  const available = deptBeds.filter((item) => item.status === "available").length;
  return (
    <div>
      <div className="detail-head">
        <div>
          <h2>{room.id}</h2>
          <p className="overview-sub">
            {room.deptLabel} · {floor.name}
          </p>
        </div>
        <div className="head-actions">
          {room.status && (
            <span className="pill" style={{ color: STATUS[room.status].color }}>
              <i style={{ background: STATUS[room.status].color }} />
              {STATUS[room.status].label}
            </span>
          )}
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close room">
            ×
          </button>
        </div>
      </div>

      <div className="bed-sketch" aria-hidden="true">
        <svg viewBox="0 0 160 90">
          <rect x="8" y="8" width="144" height="74" rx="6" fill="#f8fafc" stroke="#cbd5e1" />
          <rect x="58" y="28" width="44" height="22" rx="4" fill="#fff" stroke="#94a3b8" />
          <text x="80" y="70" textAnchor="middle" fontSize="11" fill="#64748b">
            {room.w.toFixed(2)} × {room.h.toFixed(2)} m
          </text>
        </svg>
      </div>

      <div className="tabs">
        {["overview", "patients", "equipment", "history"].map((item) => (
          <button
            key={item}
            type="button"
            className={tab === item ? "is-on" : ""}
            onClick={() => onTab(item)}
          >
            {item}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="sheet">
          <div className="meta-row">
            <span>Bed</span>
            <strong>{room.census ? "1" : "—"}</strong>
          </div>
          <div className="meta-row">
            <span>Room type</span>
            <strong>{room.type}</strong>
          </div>
          <div className="meta-row">
            <span>Area</span>
            <strong>{room.area.toFixed(1)} m²</strong>
          </div>
          {room.census && deptBeds.length > 0 && (
            <div className="donut-row">
              <svg viewBox="0 0 36 36" className="donut">
                <circle cx="18" cy="18" r="14" fill="none" stroke="#e2e8f0" strokeWidth="4" />
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth="4"
                  strokeDasharray={`${occPct} ${100 - occPct}`}
                  strokeDashoffset="25"
                  pathLength="100"
                />
                <text x="18" y="20" textAnchor="middle" fontSize="8" fontWeight="700" fill="#0f172a">
                  {occPct}%
                </text>
              </svg>
              <div>
                <p className="kicker">Occupancy · {room.deptLabel}</p>
                <ul>
                  <li><i className="amber" /> Occupied {deptOccupiedSafe(deptBeds)}</li>
                  <li><i className="teal" /> Available {available}</li>
                  <li><i className="red" /> Critical {critical}</li>
                </ul>
              </div>
            </div>
          )}
          {(room.physician || room.charge) && (
            <div className="team">
              <p className="kicker">Care team</p>
              {room.physician && <p>Attending · {room.physician}</p>}
              {room.nurse && <p>Primary nurse · {room.nurse}</p>}
              {room.charge && <p>Charge nurse · {room.charge}</p>}
            </div>
          )}
        </div>
      )}

      {tab === "patients" && (
        <div className="sheet">
          {room.patient ? (
            <>
              <div className="meta-row"><span>Patient</span><strong>{room.patient}</strong></div>
              <div className="meta-row"><span>Acuity</span><strong>{STATUS[room.status].label}</strong></div>
              <div className="meta-row"><span>Attending</span><strong>{room.physician}</strong></div>
              <div className="meta-row"><span>Nurse</span><strong>{room.nurse}</strong></div>
            </>
          ) : (
            <p>No patient in this space. {room.census ? "The bed is open for assignment." : "This room is not an inpatient bed."}</p>
          )}
        </div>
      )}

      {tab === "equipment" && (
        <ul className="equip">
          {gear.length === 0 && <li>No bedside devices in this room.</li>}
          {gear.map((item) => (
            <li key={item.name}>
              <span>{item.name}</span>
              <strong className={item.state === "Operational" ? "ok" : "warn"}>{item.state}</strong>
            </li>
          ))}
        </ul>
      )}

      {tab === "history" && (
        <ul className="activity">
          {(room.activity || [{ time: "—", text: "No clinical events on this room.", tag: "Floor" }]).map((item) => (
            <li key={`${item.time}-${item.text}`}>
              <strong>{item.time}</strong>
              <span>{item.text}</span>
              <em>{item.tag}</em>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function deptOccupiedSafe(beds) {
  return beds.filter((item) => ["critical", "warning", "normal"].includes(item.status)).length;
}
