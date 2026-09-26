import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import LoginButton from "../auth/LoginButton";
import ElevatorPanel from "./ElevatorPanel";
import FloorPlan from "./FloorPlan";
import Capacity from "./Capacity";
import Overview from "./Overview";
import PatientFlow from "./PatientFlow";
import Reports from "./Reports";
import {
  BUILDING,
  FRAME,
  SPACE_FILTERS,
  STATUS,
  applyCensus,
  buildHospital,
  findRooms,
  spaceBucket,
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
  { id: "staff", label: "Staff", icon: "users" },
  { id: "incidents", label: "Incidents", icon: "alert" },
  { id: "reports", label: "Reports", icon: "chart" },
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

const ROOM_VOICES = [
  "voice-01-three-hours.mp3",
  "voice-02-waiting-room.mp3",
  "voice-03-psychological.mp3",
  "voice-04-same-pill.mp3",
  "voice-05-phone.mp3",
  "voice-06-leaving.mp3",
  "voice-07-smile.mp3",
  "voice-08-beeping.mp3",
  "voice-09-quick.mp3",
  "voice-10-observe.mp3",
  "voice-11-big-toe.mp3",
  "voice-12-vacation.mp3",
  "voice-13-five-minutes.mp3",
  "voice-14-gown.mp3",
  "voice-15-bill.mp3",
  "voice-16-ulcer.mp3",
  "voice-17-knee.mp3",
  "voice-18-xray.mp3",
  "voice-19-number.mp3",
  "voice-20-paperwork.mp3",
  "voice-21-meeting.mp3",
  "voice-22-pills.mp3",
  "voice-23-extra.mp3",
  "voice-24-still.mp3",
  "voice-25-loyalty.mp3",
  "voice-26-bandage.mp3",
  "voice-27-ice.mp3",
  "voice-28-deluxe.mp3",
  "voice-29-coffee.mp3",
  "voice-30-clipboard.mp3",
  "voice-31-sneeze.mp3",
  "voice-32-intern.mp3",
  "voice-33-thank-you.mp3",
  "voice-34-my-name.mp3",
  "voice-35-pain-gone.mp3",
  "voice-36-warm-blanket.mp3",
  "voice-37-not-scared.mp3",
  "voice-38-kind-team.mp3",
  "voice-39-breathe.mp3",
  "voice-40-listened.mp3",
  "voice-41-discharge.mp3",
  "voice-42-five-stars.mp3",
  "voice-43-family.mp3",
  "voice-44-how-i-slept.mp3",
  "voice-45-pain-two.mp3",
  "voice-46-gentle-floor.mp3",
  "voice-47-safe.mp3",
  "voice-48-found-it.mp3",
];

const VOICE_DEPTS = new Set([
  "icu",
  "surgery",
  "imaging",
  "ed",
  "trauma",
  "med",
  "surgward",
  "pacu",
  "pharmacy",
  "waiting",
  "outpatient",
  "clinic",
  "nurse",
  "conference",
]);

function voiceForRoom(room) {
  if (!VOICE_DEPTS.has(room.dept)) return null;
  let hash = 0;
  for (let i = 0; i < room.id.length; i += 1) {
    hash = (Math.imul(hash, 31) + room.id.charCodeAt(i)) >>> 0;
  }
  return ROOM_VOICES[hash % ROOM_VOICES.length];
}

const NOTES = {
  overview: "Census for this floor is the card on the left. The plate stays on screen.",
  capacity: "Open beds are the available count. Surge fills Emergency and ICU first.",
  flow: "Every admit, floor move, OR case, discharge, and diversion.",
  staff: "Each occupied bed shows the attending and the primary nurse. The charge nurse covers the unit.",
  reports: "Counts come from the live census and the last 200 flow events.",
  three: "3D is off. This command view is the measured 2D plate.",
};

const DEFAULT_INCIDENTS = [
  {
    id: "INC-241",
    roomId: "ED-T1",
    title: "Patient fall on arrival — bay held for assessment",
    severity: "high",
    status: "open",
    createdAt: "2026-09-26T08:00:00Z",
    photo: "/faces/face-10-scared.png",
  },
  {
    id: "INC-236",
    roomId: "ICU-305",
    title: "Combative patient — restraints and security requested",
    severity: "critical",
    status: "open",
    createdAt: "2026-09-26T07:41:00Z",
    photo: "/faces/face-01-mad.png",
  },
  {
    id: "INC-228",
    roomId: "OBS-2",
    title: "Patient reports chest pain — spill blocking the doorway",
    severity: "medium",
    status: "open",
    createdAt: "2026-09-26T07:12:00Z",
    photo: "/faces/face-06-sad.png",
  },
  {
    id: "INC-189",
    roomId: "ICU-301",
    title: "ICU bed held for engineering inspection",
    severity: "medium",
    status: "resolved",
    createdAt: "2026-09-25T15:22:00Z",
    photo: "/faces/face-03-happy.png",
  },
];

function applyIncidentState(hospital, incidents) {
  const openIncidents = new Map(
    incidents
      .filter((incident) => incident.status === "open")
      .map((incident) => [incident.roomId, incident]),
  );

  return hospital.map((floor) => ({
    ...floor,
    rooms: floor.rooms.map((room) => {
      const incident = openIncidents.get(room.id);
      if (!incident) {
        return room.status === "blocked" ? { ...room, status: room._incidentBaseline || "available", _incidentBaseline: null, incidentId: null, incidentTitle: null } : room;
      }

      const baseline = room._incidentBaseline || room.status;
      return {
        ...room,
        status: "blocked",
        _incidentBaseline: baseline,
        incidentId: incident.id,
        incidentTitle: incident.title,
      };
    }),
  }));
}

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
      { time: "10:12", text: "Cleaning in progress", tag: "Housekeeping" },
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

const CLEAN_LABEL = { standard: "Standard", terminal: "Terminal", stat: "STAT" };
const LINEN_LABEL = {
  pickup: "Soiled pickup",
  wash: "Wash",
  deliver: "Clean delivery",
  ready: "Sheets here",
};

function cleanLabel(type) {
  return CLEAN_LABEL[type] || "Standard";
}

function ticksLabel(ticks) {
  if (ticks === 0) return "Done";
  if (ticks == null) return "—";
  const seconds = ticks * 9;
  if (seconds >= 60) return `${ticks} ticks · ~${Math.round(seconds / 60)} min`;
  return `${ticks} ticks · ~${seconds}s`;
}

function cleanQueue(hospital) {
  return hospital
    .flatMap((floor) => floor.rooms)
    .filter((room) => room.status === "cleaning" && !room.housekeeper && room.ticksLeft !== 0)
    .sort((a, b) => {
      const priority = (b.cleanPriority || 0) - (a.cleanPriority || 0);
      if (priority) return priority;
      const queued = (a.queuedTick || 0) - (b.queuedTick || 0);
      if (queued) return queued;
      return a.id.localeCompare(b.id);
    });
}

function keeperLabel(room, queuePlace) {
  if (room.housekeeper) return room.housekeeper;
  if (room.ticksLeft === 0) return "Clean done";
  return queuePlace ? `Queued #${queuePlace}` : "Queued";
}

function linenLabel(stage) {
  return LINEN_LABEL[stage] || "—";
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
  const [hospital, setHospital] = useState(() => applyIncidentState(buildHospital(), DEFAULT_INCIDENTS));
  const [incidents, setIncidents] = useState(DEFAULT_INCIDENTS);
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
  const [spaceFilter, setSpaceFilter] = useState("all");
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [syncTick, setSyncTick] = useState(() => Date.now());
  const [zoom, setZoom] = useState(1.25);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fitToken, setFitToken] = useState(0);
  const [incidentTitle, setIncidentTitle] = useState("");
  const [incidentSeverity, setIncidentSeverity] = useState("high");
  const [incidentPhoto, setIncidentPhoto] = useState(null);
  const mapRef = useRef(null);
  const sfxRef = useRef(null);
  const knownFlow = useRef(null);
  const zoomRef = useRef(1.25);
  const [tab, setTab] = useState("overview");
  const [toast, setToast] = useState("");
  const [now, setNow] = useState(() => new Date());

  const floor = hospital.find((level) => level.id === floorId) || hospital[2];
  const summary = useMemo(() => summarize(floor), [floor]);
  const spaceCounts = useMemo(() => {
    const counts = { all: 0, available: 0, occupied: 0, cleaning: 0, reserved: 0, down: 0 };
    for (const room of floor.rooms) {
      if (!room.census) continue;
      counts.all += 1;
      const bucket = spaceBucket(room);
      if (bucket) counts[bucket] += 1;
    }
    return counts;
  }, [floor]);
  const liveMap = nav === "live";
  const selected = floor.rooms.find((room) => room.id === selectedId) || null;
  const hits = useMemo(() => findRooms(hospital, query), [hospital, query]);
  const openIncidents = useMemo(() => incidents.filter((item) => item.status === "open"), [incidents]);
  const resolvedIncidents = useMemo(() => incidents.filter((item) => item.status === "resolved").slice(0, 3), [incidents]);
  const waitingClean = useMemo(() => cleanQueue(hospital), [hospital]);
  const queuePlace = useMemo(() => {
    const places = new Map();
    waitingClean.forEach((room, index) => places.set(room.id, index + 1));
    return places;
  }, [waitingClean]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!liveMap) return undefined;
    const timer = setInterval(() => setSyncTick(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [liveMap]);

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
    setSummaryOpen(true);
    setFitToken((token) => token + 1);
    if (nav !== "incidents" && nav !== "flow" && nav !== "capacity" && nav !== "reports") setNav("live");
  }

  function playRoomSfx(id) {
    const room = floor.rooms.find((item) => item.id === id);
    if (!room) return;

    const filename = SFX_BY_ROOM_ID[room.id] || voiceForRoom(room) || SFX_BY_DEPARTMENT[room.dept];
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
    const boards = ["overview", "capacity", "flow", "incidents", "reports"];
    const onBoard = boards.includes(nav);
    const stayingBoard = boards.includes(id);
    if (onBoard && !stayingBoard) setFitToken((token) => token + 1);
    setNav(id);
    if (id === "live") {
      setNote(null);
      setSummaryOpen(true);
      return;
    }
    if (id === "incidents" || stayingBoard) {
      setNote(null);
      return;
    }
    setNote(NOTES[id]);
  }

  function onIncidentPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) {
      setIncidentPhoto(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setIncidentPhoto(reader.result);
    reader.readAsDataURL(file);
  }

  function reportIncident() {
    const targetRoomId = selectedId || floor.rooms.find((room) => room.census)?.id || "ED-T1";
    const title = incidentTitle.trim() || `${targetRoomId} needs engineering review`;

    setIncidents((current) => [
      {
        id: `INC-${Date.now()}`,
        roomId: targetRoomId,
        title,
        severity: incidentSeverity,
        status: "open",
        createdAt: new Date().toISOString(),
        photo: incidentPhoto,
      },
      ...current,
    ]);

    setHospital((current) => current.map((level) => ({
      ...level,
      rooms: level.rooms.map((room) => {
        if (room.id !== targetRoomId) return room;
        const baseline = room._incidentBaseline || room.status;
        return {
          ...room,
          status: "blocked",
          _incidentBaseline: baseline,
          incidentId: `INC-${Date.now()}`,
          incidentTitle: title,
        };
      }),
    })));

    setSelectedId(targetRoomId);
    setNav("incidents");
    setIncidentTitle("");
    setIncidentPhoto(null);
    setToast(`${targetRoomId} is now blocked until resolved.`);
  }

  function resolveIncident(incidentId) {
    const incident = incidents.find((item) => item.id === incidentId);
    if (!incident) return;

    setIncidents((current) => current.map((item) => (
      item.id === incidentId ? { ...item, status: "resolved" } : item
    )));

    setHospital((current) => current.map((level) => ({
      ...level,
      rooms: level.rooms.map((room) => {
        if (room.id !== incident.roomId) return room;
        const nextStatus = room._incidentBaseline || "available";
        return {
          ...room,
          status: nextStatus,
          _incidentBaseline: null,
          incidentId: null,
          incidentTitle: null,
        };
      }),
    })));

    setToast(`${incident.roomId} is available again.`);
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
    const frame = stage.querySelector(".map-body") || stage;
    const stageRect = frame.getBoundingClientRect();
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
    const bw = BUILDING.w + 2.4;
    const bh = BUILDING.h + 2.4;
    const scaleW = (FRAME.w * freeW) / (bw * width);
    const scaleH = (FRAME.h * freeH) / (bh * height);
    const z = Math.max(0.22, Math.min(scaleW, scaleH));
    zoomRef.current = z;
    setZoom(z);
    const fx = (left + freeW / 2) / width;
    const fy = (top + freeH / 2) / height;
    setPan({
      x: BUILDING.x + BUILDING.w / 2 - fx * (FRAME.w / z) - FRAME.x,
      y: BUILDING.y + BUILDING.h / 2 - fy * (FRAME.h / z) - FRAME.y,
    });
  }, [fitToken]);

  function fitMap() {
    setFitToken((token) => token + 1);
  }

  function changeZoom(direction) {
    const next = Math.min(3.6, Math.max(0.22, zoom * (direction > 0 ? 1.15 : 0.87)));
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
  const rightOpen = Boolean(selected) || Boolean(note);

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
              <div className="campus-photo">
                <img src="/main-hospital.jpg?v=3" alt="Main Hospital" />
                <div className="campus-meta">
                  <span>Campus</span>
                  <strong>Main Hospital</strong>
                  <em>{floor.subtitle || floor.name}</em>
                </div>
              </div>
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
          {nav === "incidents" && (
            <div className="incidents-page">
              <div className="incident incident-panel">
                <div className="detail-head">
                  <div>
                    <p className="kicker">Operations</p>
                    <h2>Incidents</h2>
                  </div>
                </div>

                <div className="incidents-cols">
                  <div className="incidents-col incidents-col-form">
                    <div className="incident-form">
                      <label>
                        <span>Room</span>
                        <strong>{selectedId || "ED-T1"}</strong>
                      </label>
                      <label>
                        <span>Issue</span>
                        <input
                          value={incidentTitle}
                          onChange={(event) => setIncidentTitle(event.target.value)}
                          placeholder="Describe the blockage"
                        />
                      </label>
                      <label>
                        <span>Severity</span>
                        <select value={incidentSeverity} onChange={(event) => setIncidentSeverity(event.target.value)}>
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                      </label>
                      <label>
                        <span>Photo</span>
                        <div className="incident-photo-field">
                          {incidentPhoto ? (
                            <div className="incident-photo-preview">
                              <img src={incidentPhoto} alt="Incident attachment preview" />
                              <button
                                type="button"
                                className="incident-photo-remove"
                                onClick={() => setIncidentPhoto(null)}
                                aria-label="Remove photo"
                              >
                                ×
                              </button>
                            </div>
                          ) : (
                            <label className="incident-photo-drop">
                              <input type="file" accept="image/*" onChange={onIncidentPhoto} />
                              <span>Add a photo</span>
                            </label>
                          )}
                        </div>
                      </label>
                      <button type="button" className="surge-btn" onClick={reportIncident}>
                        Report incident
                      </button>
                    </div>

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

                  <div className="incidents-col incidents-col-list">
                    <div className="incident-section">
                      <p className="kicker">Open</p>
                      {openIncidents.length === 0 ? (
                        <p className="detail-copy">No active incidents on the floor.</p>
                      ) : (
                        <ul className="incident-list">
                          {openIncidents.map((item) => (
                            <li key={item.id} className={item.photo ? "incident-row has-photo" : "incident-row"}>
                              {item.photo && (
                                <img className="incident-photo" src={item.photo} alt={`${item.roomId} incident`} />
                              )}
                              <div className="incident-row-body">
                                <div className="incident-row-head">
                                  <strong>{item.roomId}</strong>
                                  <span className={`severity severity-${item.severity}`}>{item.severity}</span>
                                </div>
                                <p>{item.title}</p>
                                <div className="incident-row-meta">
                                  <small>{new Date(item.createdAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</small>
                                  <button type="button" onClick={() => resolveIncident(item.id)}>Resolve</button>
                                </div>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="incident-section">
                      <p className="kicker">Recent</p>
                      <ul className="incident-list compact">
                        {resolvedIncidents.length === 0 && <li className="detail-copy">No recent closures.</li>}
                        {resolvedIncidents.map((item) => (
                          <li key={item.id} className={item.photo ? "incident-row resolved has-photo" : "incident-row resolved"}>
                            {item.photo && (
                              <img className="incident-photo" src={item.photo} alt={`${item.roomId} incident`} />
                            )}
                            <div className="incident-row-body">
                              <div className="incident-row-head">
                                <strong>{item.roomId}</strong>
                                <span className="severity resolved-tag">Resolved</span>
                              </div>
                              <p>{item.title}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
          {nav === "reports" && (
            <Reports
              hospital={hospital}
              movements={movements}
              transfers={transfers}
              flowLive={flowLive}
              syncedAt={flowSyncedAt}
              onOpenRoom={(floorId, roomId) => {
                const level = hospital.find((item) => item.id === floorId);
                const room = level?.rooms.find((item) => item.id === roomId);
                if (level && room) openHit({ floor: level, room });
              }}
            />
          )}
          {nav !== "overview" && nav !== "capacity" && nav !== "flow" && nav !== "incidents" && nav !== "reports" && (
          <div
            ref={mapRef}
            className={`map-stage${rightOpen ? " has-detail" : ""}${liveMap ? " is-live" : ""}`}
            onClick={() => {
              setSearchOpen(false);
              setBellOpen(false);
            }}
          >
            {liveMap && (
              <header className="live-bar">
                <div className="live-bar-top">
                  <div>
                    <p className="live-kicker">Live map · {floor.code}</p>
                    <h2 className="live-title">{floor.subtitle || floor.name}</h2>
                  </div>
                  <div className="live-actions">
                    <span className={flowLive ? "live-sync" : "live-sync is-wait"}>
                      <i />
                      {flowLive && flowSyncedAt
                        ? `Simulation · Synced ${Math.max(0, Math.round((syncTick - flowSyncedAt) / 1000))}s ago`
                        : "Simulation · Waiting"}
                    </span>
                    <button
                      type="button"
                      className="live-btn is-on"
                      onClick={() => {
                        setSummaryOpen(true);
                        fitMap();
                      }}
                    >
                      Floor summary
                    </button>
                  </div>
                </div>
                <div className="space-filters" role="toolbar" aria-label="Filter spaces">
                  {SPACE_FILTERS.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={spaceFilter === item.id ? "space-chip is-on" : "space-chip"}
                      onClick={() => setSpaceFilter(item.id)}
                    >
                      {item.dot && <i style={{ background: item.dot }} />}
                      {item.label}
                      <b>{spaceCounts[item.id]}</b>
                    </button>
                  ))}
                </div>
                {spaceFilter !== "all" && spaceCounts[spaceFilter] === 0 && (
                  <p className="space-empty">
                    No {SPACE_FILTERS.find((item) => item.id === spaceFilter)?.empty} on {floor.code}.{" "}
                    <button type="button" onClick={() => setSpaceFilter("all")}>Clear filter</button>
                  </p>
                )}
              </header>
            )}
            <div className="map-body">
            {(!liveMap || summaryOpen) && (
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
            )}

            <div className="map-canvas">
            <FloorPlan
              floor={floor}
              deptFilter="all"
              spaceFilter={liveMap ? spaceFilter : "all"}
              layer="all"
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

            <div className="zoom-tools" role="group" aria-label="Zoom">
              <button type="button" onClick={() => changeZoom(1)} aria-label="Zoom in">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M7 1.5v11M1.5 7h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
              <button type="button" onClick={() => changeZoom(-1)} aria-label="Zoom out">
                <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                  <path d="M1.5 7h11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className={liveMap ? "legend legend-status" : "legend"}>
              {liveMap ? (
                SPACE_FILTERS.filter((item) => item.dot).map((item) => (
                  <span key={item.id}><i className="lg-dot" style={{ background: item.dot }} /> {item.label}</span>
                ))
              ) : (
                <>
                  <span><i className="lg lg-elev" /> Elevator</span>
                  <span><i className="lg lg-stair" /> Staircase</span>
                  <span><i className="lg lg-wc" /> Lavatory</span>
                </>
              )}
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
                {note && (
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

                {!note && selected && (
                  <RoomCard
                    room={selected}
                    floor={floor}
                    tab={tab}
                    onTab={setTab}
                    occPct={occPct}
                    deptBeds={deptBeds}
                    movements={movements}
                    queuePlace={queuePlace.get(selected.id) || null}
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
                {hover.room.status === "cleaning" && (
                  <small>
                    {cleanLabel(hover.room.cleanType)}
                    {" · "}
                    {keeperLabel(hover.room, queuePlace.get(hover.room.id))}
                    {" · "}
                    {linenLabel(hover.room.linenStage)}
                  </small>
                )}
              </div>
            )}
            </div>
          </div>
          )}
        </main>
      </div>
    </div>
  );
}

function RoomCard({ room, floor, tab, onTab, occPct, deptBeds, movements = [], queuePlace = null, onClose }) {
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
          {room.status === "cleaning" && (
            <>
              <Meta label="Clean type">{cleanLabel(room.cleanType)}</Meta>
              <Meta label="Housekeeper">{keeperLabel(room, queuePlace)}</Meta>
              <Meta label="Time left">{ticksLabel(room.ticksLeft)}</Meta>
              <Meta label="Linen">{room.linenAide ? `${room.linenAide} · ${linenLabel(room.linenStage)}` : linenLabel(room.linenStage)}</Meta>
              <Meta label="Linen time">{room.linenStage === "ready" ? "Here" : ticksLabel(room.linenTicks)}</Meta>
            </>
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
                {room.status === "cleaning"
                  ? "This bed is closed for cleaning. It stays closed until housekeeping finishes and clean linen arrives."
                  : room.census
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
