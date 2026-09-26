import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import LoginButton from "../auth/LoginButton";
import ElevatorPanel from "./ElevatorPanel";
import FloorPlan from "./FloorPlan";
import Capacity from "./Capacity";
import Overview from "./Overview";
import PatientFlow from "./PatientFlow";
import {
  BUILDING,
  FRAME,
  STATUS,
  applyCensus,
  buildHospital,
  findRooms,
  summarize,
} from "./floors";
import { apiUrl } from "../api/client";
import { roomVisualSrc } from "./roomVisuals";
import { flowBucket } from "./flowBuckets";
import "./dashboard.css";
import logo from "./logo.png";

const NAV = [
  { id: "live", label: "Live Map", icon: "map" },
  { id: "overview", label: "Overview", icon: "grid" },
  { id: "capacity", label: "Capacity", icon: "bed" },
  { id: "flow", label: "Patient Flow", icon: "flow" },
  { id: "turnover", label: "Bed turnover", icon: "broom" },
  { id: "staff", label: "Staff", icon: "users" },
  { id: "incidents", label: "Incidents", icon: "alert" },
  { id: "reports", label: "Reports", icon: "chart" },
  { id: "settings", label: "Settings", icon: "gear" },
];

const SFX_BY_DEPARTMENT = {
  icu: "Intesive Care.mp3",
  surgery: "Surgery.mp3",
  imaging: "Radiology.mp3",
  ed: "Emergency&Trauma.mp3",
  trauma: "Emergency&Trauma.mp3",
  med: "Clinic.mp3",
  surgward: "Surgery.mp3",
  pacu: "Support&Recovery.mp3",
  pharmacy: "Clinic.mp3",
  waiting: "Waiting(cut).mp3",
  outpatient: "Clinic.mp3",
  support: "Support&Recovery.mp3",
  nurse: "Staff(cut).mp3",
  spd: "Surgery.mp3",
  storage: "Storage.mp3",
  morgue: "Storage.mp3",
  mechanical: "Storage.mp3",
  dock: "Storage.mp3",
  clinic: "Clinic.mp3",
  admin: "Admin.mp3",
  conference: "Conference.mp3",
};

const SFX_BY_ROOM_ID = {
  REG: "Registration.mp3",
  ADMIN: "Trump.mp3",
};

const NOTES = {
  overview: "Census for this floor is the card on the left. The plate stays on screen.",
  capacity: "Open beds are the available count. Surge fills Emergency and ICU first.",
  flow: "Every admit, floor move, OR case, discharge, and diversion.",
  turnover: "Purple beds are in cleaning. They are not free until housekeeping marks them ready.",
  staff: "Each occupied bed shows the attending and the primary nurse. The charge nurse covers the unit.",
  reports: "Reports stay off this demo. The live plate is the operational view.",
  settings: "Settings stay off this demo. Floor maps and the elevator are local.",
  three: "3D is off. This command view is the measured 2D plate.",
};

function Icon({ name }) {
  const common = {
    width: 20,
    height: 20,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
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

function esiFor(status) {
  if (status === "critical") return "ESI 1 · Immediate";
  if (status === "warning") return "ESI 2 · Emergent";
  if (status === "normal") return "ESI 3 · Urgent";
  return "—";
}

function vitalsFor(room) {
  if (!room?.patient) return null;
  if (room.status === "critical") {
    return { hr: "118", bp: "88/54", spo2: "91%", rr: "28", temp: "38.4°C" };
  }
  if (room.status === "warning") {
    return { hr: "104", bp: "148/92", spo2: "94%", rr: "22", temp: "37.8°C" };
  }
  return { hr: "82", bp: "128/78", spo2: "98%", rr: "16", temp: "36.9°C" };
}

function planFor(room) {
  if (!room?.patient) return [];
  const steps = [];
  if (room.chiefComplaint) steps.push(`Address: ${room.chiefComplaint}`);
  if (room.diagnosis) steps.push(`Working dx: ${room.diagnosis}`);
  if (room.needsOr) steps.push("OR hold requested — surgeon notified");
  if (room.status === "critical") {
    steps.push("Stay with patient · q5 min vitals");
    steps.push("Blood bank / imaging on standby");
  } else if (room.status === "warning") {
    steps.push("Reassess in 15 min · escalate if worsening");
  } else {
    steps.push("Await labs / imaging · disposition pending");
  }
  return steps;
}

function historyFor(room, movements = []) {
  const live = (movements || [])
    .filter((item) => item.room_id === room.id || (room.patient && item.patient_name === room.patient))
    .slice(0, 8)
    .map((item) => {
      const stamp = item.created_at ? new Date(item.created_at) : null;
      const time = stamp && !Number.isNaN(stamp.getTime())
        ? stamp.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "—";
      return {
        time,
        text: item.message,
        tag: item.patient_name === "Command" || item.patient_name === "Housekeeping" || item.patient_name === "Census"
          ? item.patient_name
          : "Flow",
      };
    });

  if (live.length) return live;

  if (room.activity?.length) return room.activity;

  if (!room.census) {
    return [{ time: "—", text: "No clinical events logged for this space.", tag: "Floor" }];
  }

  if (room.status === "available") {
    return [
      { time: "09:40", text: "Bed marked ready for assignment", tag: "Housekeeping" },
      { time: "09:22", text: "Terminal clean complete", tag: "EVS" },
    ];
  }
  if (room.status === "cleaning") {
    return [
      { time: "10:12", text: "Turnover in progress", tag: "Housekeeping" },
      { time: "10:05", text: "Previous patient discharged", tag: "Nursing" },
    ];
  }
  if (room.patient) {
    const rows = [
      { time: "10:18", text: `${room.patient} assigned to ${room.id}`, tag: "Charge nurse" },
      { time: "10:05", text: room.chiefComplaint || "Chief complaint documented", tag: "Triage" },
      { time: "09:52", text: room.diagnosis ? `Working diagnosis: ${room.diagnosis}` : "Workup started", tag: "Physician" },
      { time: "09:40", text: `${room.physician || "Attending"} at bedside`, tag: "Physician" },
      { time: "09:28", text: `${room.nurse || "Primary nurse"} assumed care`, tag: "Nursing" },
    ];
    if (room.needsOr) rows.splice(2, 0, { time: "09:58", text: "OR reservation requested", tag: "Surgery" });
    if (room.status === "critical") rows.unshift({ time: "10:24", text: "Acuity raised to critical", tag: "Charge nurse" });
    return rows;
  }
  return [{ time: "—", text: "No clinical events on this room.", tag: "Floor" }];
}

function Meta({ label, children }) {
  return (
    <div className="meta-row">
      <span>{label}</span>
      <strong>{children}</strong>
    </div>
  );
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
  const [floorId, setFloorId] = useState("F1");
  const [selectedId, setSelectedId] = useState("ED-T1");
  const [hover, setHover] = useState(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [nav, setNav] = useState("live");
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [note, setNote] = useState(null);
  const [elevatorOpen, setElevatorOpen] = useState(false);
  const [surgeOn, setSurgeOn] = useState(false);
  const [transfers, setTransfers] = useState([]);
  const [roster, setRoster] = useState([]);
  const [movements, setMovements] = useState([]);
  const [flowLive, setFlowLive] = useState(false);
  const [flowSyncedAt, setFlowSyncedAt] = useState(null);
  const [flowNotice, setFlowNotice] = useState("");
  const [badge, setBadge] = useState(1);
  const [bellOpen, setBellOpen] = useState(false);
  const [showBeds, setShowBeds] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [zoom, setZoom] = useState(1.25);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fitToken, setFitToken] = useState(0);
  const mapRef = useRef(null);
  const sfxRef = useRef(null);
  const knownFlow = useRef(null);
  const zoomRef = useRef(1.25);
  const startZoom = useRef(null);
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
    let stop = false;

    async function pull() {
      try {
        const [censusRes, transferRes, flowRes, staffRes] = await Promise.all([
          fetch(apiUrl("/api/census")),
          fetch(apiUrl("/api/transfers")),
          fetch(apiUrl("/api/flow")),
          fetch(apiUrl("/api/staff")),
        ]);
        if (stop) return;
        if (censusRes.ok) {
          const census = await censusRes.json();
          if (stop) return;
          setHospital((current) => applyCensus(current, census.rooms));
          setSurgeOn(Boolean(census.surge));
        }
        if (transferRes.ok) {
          const body = await transferRes.json();
          if (!stop) setTransfers(body.transfers || []);
        }
        if (staffRes.ok) {
          const body = await staffRes.json();
          if (!stop) setRoster(body.staff || []);
        }
        if (flowRes.ok) {
          const body = await flowRes.json();
          if (!stop) {
            setMovements(body.events || []);
            setFlowLive(true);
            setFlowSyncedAt(Date.now());
          }
        } else if (!stop) {
          setFlowLive(false);
        }
      } catch {
        if (!stop) setFlowLive(false);
      }
    }

    pull();
    const timer = setInterval(pull, 4000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const ids = new Set(movements.map((item) => item.id));
    if (knownFlow.current == null) {
      knownFlow.current = ids;
      return;
    }
    const arrived = movements.filter((item) => !knownFlow.current.has(item.id));
    knownFlow.current = ids;
    if (nav === "flow" || arrived.length === 0) return;
    const critical = arrived.find((item) => {
      const bucket = flowBucket(item);
      return bucket === "death" || bucket === "divert";
    });
    if (!critical) return;
    const code = flowBucket(critical) === "death" ? "DTH" : "DV";
    setFlowNotice(`${code}  ${critical.patient_name || critical.message}`);
  }, [movements, nav]);

  useEffect(() => {
    if (!flowNotice) return undefined;
    const timer = setTimeout(() => setFlowNotice(""), 8000);
    return () => clearTimeout(timer);
  }, [flowNotice]);

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
    setElevatorOpen(false);
    setHover(null);
    setNote(null);
    setFitToken((token) => token + 1);
    if (nav !== "incidents" && nav !== "flow" && nav !== "capacity") setNav("live");
  }

  function playRoomSfx(id) {
    const room = floor.rooms.find((item) => item.id === id);
    if (!room) return;

    const filename = SFX_BY_ROOM_ID[room.id] || SFX_BY_DEPARTMENT[room.dept];
    if (!filename) return;

    sfxRef.current?.pause();
    const audio = new Audio(`/sfx/${filename}`);
    sfxRef.current = audio;
    if (filename.includes("(cut)")) {
      audio.addEventListener("timeupdate", () => {
        if (audio.currentTime >= 10) audio.pause();
      });
    }
    audio.play().catch(() => {});
  }

  function openHit(hit) {
    setFloorId(hit.floor.id);
    setSelectedId(hit.room.id);
    setNav("live");
    setNote(null);
    setElevatorOpen(false);
    setSearchOpen(false);
    setQuery(hit.room.id);
    setTab("overview");
    frameRoom(hit.room);
  }

  function chooseNav(id) {
    setElevatorOpen(false);
    const onBoard = nav === "overview" || nav === "capacity" || nav === "flow";
    const stayingBoard = id === "overview" || id === "capacity" || id === "flow";
    if (onBoard && !stayingBoard) setFitToken((token) => token + 1);
    setNav(id);
    if (id === "incidents" || id === "flow" || id === "overview" || id === "capacity") {
      setNote(null);
      return;
    }
    if (id === "live") {
      setNote(null);
      return;
    }
    setNote(NOTES[id]);
  }

  async function declareSurge() {
    if (surgeOn) return;
    try {
      const res = await fetch(apiUrl("/api/surge"), { method: "POST" });
      if (!res.ok) return;
      const data = await res.json();
      setHospital((current) => applyCensus(current, data.rooms));
      setSurgeOn(true);
      setBadge(3);
      setNav("incidents");
      setToast(
        data.flipped
          ? `${data.flipped} open beds on F1 and F3 are now held for the train collision.`
          : "No open surge beds left on F1 or F3.",
      );
    } catch {
      setToast("Could not reach the census service.");
    }
  }

  zoomRef.current = zoom;

  useLayoutEffect(() => {
    const stage = mapRef.current;
    if (!stage) return;
    const stageRect = stage.getBoundingClientRect();
    const overview = stage.querySelector(".overview");
    const detail = stage.querySelector(".detail");
    const width = stageRect.width;
    const height = stageRect.height;
    if (width < 80 || height < 80) return;
    const left = overview ? overview.getBoundingClientRect().right - stageRect.left + 14 : 18;
    const right = detail ? stageRect.right - detail.getBoundingClientRect().left + 14 : 18;
    const top = 14;
    const bottom = 36;
    const freeW = Math.max(160, width - left - right);
    const freeH = Math.max(160, height - top - bottom);
    const bw = BUILDING.w + 1.2;
    const bh = BUILDING.h + 1.2;
    if (startZoom.current == null) {
      startZoom.current = Math.max(
        0.5,
        Math.min(1.8, Math.min((FRAME.w * freeW) / (bw * width), (FRAME.h * freeH) / (bh * height))),
      );
    }
    const z = startZoom.current;
    zoomRef.current = z;
    setZoom(z);
    const fx = (left + freeW / 2) / width;
    const fy = (top + freeH / 2) / height;
    setPan({
      x: BUILDING.x + BUILDING.w / 2 - fx * (FRAME.w / z) - FRAME.x,
      y: BUILDING.y + BUILDING.h / 2 - fy * (FRAME.h / z) - FRAME.y,
    });
  }, [fitToken]);

  function changeZoom(direction) {
    const next = Math.min(3.6, Math.max(0.5, zoom * (direction > 0 ? 1.15 : 0.87)));
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

  function openMovement(event) {
    if (!event.room_id) return;
    for (const level of hospital) {
      const room = level.rooms.find((item) => item.id === event.room_id);
      if (room) {
        openHit({ floor: level, room });
        return;
      }
    }
  }

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
          <span className="brand-mark" aria-hidden="true">
            <img className="brand-logo" src={logo} alt="" />
          </span>
          <div className="brand-text">
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
          <span className="search-keys" aria-hidden="true">
            <kbd>⌘</kbd>
            <kbd>K</kbd>
          </span>
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

        {flowNotice && (
          <button
            type="button"
            className="flow-notice"
            onClick={() => {
              setFlowNotice("");
              chooseNav("flow");
            }}
          >
            {flowNotice}
          </button>
        )}

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
          <span className="tool-divider" aria-hidden="true" />
          <div className="clock">
            <span>{dateLabel}</span>
            <strong>{clock}</strong>
          </div>
        </div>
      </header>

      <div className={navCollapsed ? "workspace is-slim" : "workspace"}>
        <aside className={navCollapsed ? "nav is-collapsed" : "nav"}>
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
              <img src="/main-hospital.jpg?v=3" alt="Main Hospital" />
              <strong>Main Hospital</strong>
            </div>
            <div
              className="campus-floors"
              role="group"
              aria-label="Floors"
              style={{ "--floor-index": Math.max(0, hospital.findIndex((level) => level.id === floor.id)) }}
            >
              <span className="floor-thumb" aria-hidden="true" />
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
          {nav === "capacity" && (
            <Capacity
              hospital={hospital}
              surgeOn={surgeOn}
              activeFloorId={floor.id}
              onOpenFloor={(id) => {
                setFloorId(id);
                setSelectedId(null);
                setHover(null);
                setNote(null);
                setElevatorOpen(false);
                setNav("live");
                setFitToken((token) => token + 1);
              }}
            />
          )}
          {nav === "overview" && (
            <Overview
              hospital={hospital}
              surgeOn={surgeOn}
              transfers={transfers}
              movements={movements}
              onOpenFloor={(id) => {
                setFloorId(id);
                setSelectedId(null);
                setHover(null);
                setNote(null);
                setElevatorOpen(false);
                setNav("live");
                setFitToken((token) => token + 1);
              }}
              onOpenMovement={openMovement}
              onDeclareSurge={declareSurge}
            />
          )}
          {nav === "flow" && (
            <PatientFlow
              movements={movements}
              linked={flowLive}
              syncedAt={flowSyncedAt}
              onOpenMovement={openMovement}
            />
          )}
          {nav !== "overview" && nav !== "capacity" && nav !== "flow" && (
          <div
            ref={mapRef}
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
              deptFilter="all"
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
                playRoomSfx(id);
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
                    {transfers.length > 0 && (
                      <ul className="activity">
                        {transfers.slice(0, 4).map((item) => (
                          <li key={item.id}>
                            <strong>{item.destination}</strong>
                            <span>{item.patient_name}</span>
                            <em>{item.reason === "icu_full" ? "ICU full" : "ORs full"}</em>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {nav !== "incidents" && note && (
                  <div className="incident">
                    <div className="detail-head">
                      <h2>{nav === "staff" ? "Staff" : "Live map"}</h2>
                      <button type="button" className="icon-btn" onClick={() => { setNote(null); setNav("live"); }} aria-label="Close">
                        ×
                      </button>
                    </div>
                    {nav === "staff" ? (
                      <ul className="activity">
                        {roster.length === 0 && <li><span>Roster is loading.</span></li>}
                        {roster.map((person) => (
                          <li key={person.id}>
                            <strong>{person.name}</strong>
                            <span>{person.specialty} · {person.unit.toUpperCase()} · ext {person.extension}</span>
                            <em>{person.on_duty ? `${person.shift} shift` : "Off duty"}</em>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>{note}</p>
                    )}
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
                    movements={movements}
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
          )}
        </main>
      </div>
    </div>
  );
}

function RoomCard({ room, floor, tab, onTab, occPct, deptBeds, movements = [], onClose }) {
  const critical = deptBeds.filter((item) => item.status === "critical").length;
  const available = deptBeds.filter((item) => item.status === "available").length;
  const warning = deptBeds.filter((item) => item.status === "warning").length;
  const vitals = vitalsFor(room);
  const plan = planFor(room);
  const history = historyFor(room, movements);
  const occupied = Boolean(room.patient);

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

      <div className="bed-sketch">
        <img
          src={roomVisualSrc(room)}
          alt={`${room.type} interior`}
        />
        <span className="bed-sketch-size">
          {room.w.toFixed(2)} × {room.h.toFixed(2)} m · {room.area.toFixed(1)} m²
        </span>
      </div>

      <div className="tabs">
        {["overview", "patients", "history"].map((item) => (
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
          {occupied && (
            <div className="detail-callout">
              <p className="kicker">Now in this bed</p>
              <strong>{room.patient}</strong>
              <span>{room.diagnosis || room.chiefComplaint || STATUS[room.status]?.label}</span>
            </div>
          )}

          <Meta label="Bed">{room.census ? "1 inpatient bed" : "Non-census space"}</Meta>
          <Meta label="Room type">{room.type}</Meta>
          <Meta label="Department">{room.deptLabel}</Meta>
          <Meta label="Floor">{floor.name}</Meta>
          <Meta label="Area">{room.area.toFixed(1)} m²</Meta>
          <Meta label="Surge ready">{room.surge ? "Yes — holds open for MCI" : "Standard"}</Meta>
          {room.census && (
            <Meta label="Bed status">{STATUS[room.status]?.label || "—"}</Meta>
          )}

          {room.census && deptBeds.length > 0 && (
            <div className="donut-row">
              <svg viewBox="0 0 36 36" className="donut">
                <circle cx="18" cy="18" r="14" fill="none" stroke="#dde4ee" strokeWidth="4" />
                <circle
                  cx="18"
                  cy="18"
                  r="14"
                  fill="none"
                  stroke="#4a78b0"
                  strokeWidth="4"
                  strokeDasharray={`${occPct} ${100 - occPct}`}
                  strokeDashoffset="25"
                  pathLength="100"
                />
                <text x="18" y="20" textAnchor="middle" fontSize="8" fontWeight="600" fill="#020c21">
                  {occPct}%
                </text>
              </svg>
              <div>
                <p className="kicker">Unit occupancy · {room.deptLabel}</p>
                <ul>
                  <li><i className="amber" /> Occupied {deptOccupiedSafe(deptBeds)}</li>
                  <li><i className="teal" /> Available {available}</li>
                  <li><i className="red" /> Critical {critical}</li>
                  <li><i className="slate" /> Watch {warning}</li>
                </ul>
              </div>
            </div>
          )}

          {(room.physician || room.charge || room.nurse) && (
            <div className="team">
              <p className="kicker">Care team</p>
              {room.physician && <p>Attending · {room.physician}</p>}
              {room.nurse && <p>Primary nurse · {room.nurse}</p>}
              {room.charge && <p>Charge nurse · {room.charge}</p>}
            </div>
          )}

          {occupied && plan.length > 0 && (
            <div className="detail-block">
              <p className="kicker">Immediate plan</p>
              <ul className="detail-list">
                {plan.map((step) => <li key={step}>{step}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === "patients" && (
        <div className="sheet">
          {occupied ? (
            <>
              <div className="detail-callout">
                <p className="kicker">Chief complaint</p>
                <strong>{room.chiefComplaint || "Not documented"}</strong>
                <span>{room.diagnosis || "Working diagnosis pending"}</span>
              </div>

              <Meta label="Patient">{room.patient}</Meta>
              <Meta label="Age">{room.age != null ? `${room.age} yrs` : "—"}</Meta>
              <Meta label="Acuity">{STATUS[room.status]?.label || room.acuity || "—"}</Meta>
              <Meta label="Triage">{esiFor(room.status)}</Meta>
              <Meta label="OR needed">{room.needsOr ? "Yes — hold requested" : "No"}</Meta>
              <Meta label="Attending">{room.physician || "—"}</Meta>
              <Meta label="Primary nurse">{room.nurse || "—"}</Meta>
              <Meta label="Bed">{room.id}</Meta>

              {vitals && (
                <div className="detail-block">
                  <p className="kicker">Latest vitals</p>
                  <div className="vital-grid">
                    <div><span>HR</span><strong>{vitals.hr}</strong></div>
                    <div><span>BP</span><strong>{vitals.bp}</strong></div>
                    <div><span>SpO₂</span><strong>{vitals.spo2}</strong></div>
                    <div><span>RR</span><strong>{vitals.rr}</strong></div>
                    <div><span>Temp</span><strong>{vitals.temp}</strong></div>
                  </div>
                </div>
              )}

              <div className="detail-block">
                <p className="kicker">Clinical summary</p>
                <p className="detail-copy">
                  {room.patient} is a {room.age != null ? `${room.age}-year-old` : "adult"} presenting with{" "}
                  {(room.chiefComplaint || "an acute complaint").toLowerCase()}. Current working diagnosis:{" "}
                  {room.diagnosis || "under evaluation"}. Acuity is {STATUS[room.status]?.label?.toLowerCase() || "active"}
                  {room.needsOr ? "; surgical intervention may be required." : "."}
                </p>
              </div>

              {plan.length > 0 && (
                <div className="detail-block">
                  <p className="kicker">Care plan</p>
                  <ul className="detail-list">
                    {plan.map((step) => <li key={step}>{step}</li>)}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="detail-empty">
              <p className="kicker">No patient assigned</p>
              <p className="detail-copy">
                {room.census
                  ? "This bed is open for assignment. Declare surge or wait for the next admit from triage."
                  : "This space is not an inpatient bed — use it for support workflow only."}
              </p>
            </div>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="sheet">
          <p className="kicker">Room timeline</p>
          <ul className="activity">
            {history.map((item) => (
              <li key={`${item.time}-${item.text}`}>
                <strong>{item.time}</strong>
                <span>{item.text}</span>
                <em>{item.tag}</em>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function deptOccupiedSafe(beds) {
  return beds.filter((item) => ["critical", "warning", "normal"].includes(item.status)).length;
}
