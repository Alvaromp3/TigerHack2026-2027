import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import LoginButton from "../auth/LoginButton";
import ElevatorPanel from "./ElevatorPanel";
import FloorPlan from "./FloorPlan";
import ChatPanel from "./ChatPanel";
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
import { buildLiveOps, incidentsFromCensus } from "./liveOps";
import "./dashboard.css";
import logo from "./logo.png";

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

const VOICE = {
  wait: [
    "voice-01-three-hours.mp3",
    "voice-02-waiting-room.mp3",
    "voice-13-five-minutes.mp3",
    "voice-19-number.mp3",
    "voice-24-still.mp3",
  ],
  family: [
    "voice-43-family.mp3",
    "voice-01-three-hours.mp3",
    "voice-02-waiting-room.mp3",
    "voice-13-five-minutes.mp3",
  ],
  clinic: [
    "voice-03-psychological.mp3",
    "voice-07-smile.mp3",
    "voice-11-big-toe.mp3",
    "voice-16-ulcer.mp3",
    "voice-17-knee.mp3",
    "voice-31-sneeze.mp3",
    "voice-34-my-name.mp3",
    "voice-40-listened.mp3",
    "voice-33-thank-you.mp3",
    "voice-42-five-stars.mp3",
  ],
  pharmacy: [
    "voice-04-same-pill.mp3",
    "voice-22-pills.mp3",
    "voice-23-extra.mp3",
  ],
  icu: [
    "voice-08-beeping.mp3",
    "voice-37-not-scared.mp3",
    "voice-39-breathe.mp3",
    "voice-47-safe.mp3",
    "voice-38-kind-team.mp3",
    "voice-36-warm-blanket.mp3",
  ],
  or: [
    "voice-14-gown.mp3",
    "voice-37-not-scared.mp3",
    "voice-39-breathe.mp3",
  ],
  ward: [
    "voice-28-deluxe.mp3",
    "voice-36-warm-blanket.mp3",
    "voice-44-how-i-slept.mp3",
    "voice-45-pain-two.mp3",
    "voice-46-gentle-floor.mp3",
    "voice-41-discharge.mp3",
    "voice-35-pain-gone.mp3",
    "voice-33-thank-you.mp3",
  ],
  surgWard: [
    "voice-14-gown.mp3",
    "voice-26-bandage.mp3",
    "voice-35-pain-gone.mp3",
    "voice-36-warm-blanket.mp3",
    "voice-44-how-i-slept.mp3",
    "voice-45-pain-two.mp3",
    "voice-46-gentle-floor.mp3",
    "voice-41-discharge.mp3",
  ],
  pacu: [
    "voice-35-pain-gone.mp3",
    "voice-36-warm-blanket.mp3",
    "voice-39-breathe.mp3",
    "voice-14-gown.mp3",
    "voice-41-discharge.mp3",
  ],
  imaging: [
    "voice-18-xray.mp3",
    "voice-48-found-it.mp3",
  ],
  ed: [
    "voice-09-quick.mp3",
    "voice-26-bandage.mp3",
    "voice-27-ice.mp3",
    "voice-06-leaving.mp3",
    "voice-31-sneeze.mp3",
    "voice-45-pain-two.mp3",
  ],
  trauma: [
    "voice-08-beeping.mp3",
    "voice-09-quick.mp3",
    "voice-26-bandage.mp3",
    "voice-27-ice.mp3",
    "voice-37-not-scared.mp3",
    "voice-47-safe.mp3",
  ],
  observe: [
    "voice-10-observe.mp3",
    "voice-09-quick.mp3",
    "voice-45-pain-two.mp3",
  ],
  nurse: [
    "voice-05-phone.mp3",
    "voice-30-clipboard.mp3",
    "voice-32-intern.mp3",
    "voice-38-kind-team.mp3",
    "voice-29-coffee.mp3",
  ],
  lounge: [
    "voice-12-vacation.mp3",
    "voice-29-coffee.mp3",
    "voice-32-intern.mp3",
  ],
  pt: [
    "voice-17-knee.mp3",
    "voice-27-ice.mp3",
    "voice-35-pain-gone.mp3",
  ],
  conference: [
    "voice-21-meeting.mp3",
    "voice-20-paperwork.mp3",
    "voice-25-loyalty.mp3",
  ],
  admin: [
    "voice-15-bill.mp3",
    "voice-20-paperwork.mp3",
    "voice-25-loyalty.mp3",
    "voice-42-five-stars.mp3",
  ],
  triage: [
    "voice-09-quick.mp3",
    "voice-19-number.mp3",
    "voice-01-three-hours.mp3",
    "voice-31-sneeze.mp3",
  ],
};

const VOICES_BY_TYPE = {
  "Waiting room": VOICE.wait,
  "Clinic waiting": VOICE.wait,
  "Family waiting": VOICE.family,
  "Exam room": VOICE.clinic,
  Pharmacy: VOICE.pharmacy,
  "Floor pharmacy": VOICE.pharmacy,
  "Medication room": VOICE.pharmacy,
  "ICU — Single": VOICE.icu,
  "Operating room": VOICE.or,
  Scrub: VOICE.or,
  "Post-anesthesia recovery": VOICE.pacu,
  "X-ray": VOICE.imaging,
  "CT suite": VOICE.imaging,
  "MRI suite": VOICE.imaging,
  Control: VOICE.imaging,
  "ED — Exam": VOICE.ed,
  "Fast track": VOICE.ed,
  "ED — Trauma": VOICE.trauma,
  Observation: VOICE.observe,
  Triage: VOICE.triage,
  "Nurse station": VOICE.nurse,
  "Staff station": VOICE.nurse,
  "Staff lounge": VOICE.lounge,
  "Support room": VOICE.lounge,
  "PT gym": VOICE.pt,
  Conference: VOICE.conference,
  "Board room": VOICE.conference,
  "Medical director": VOICE.admin,
};

const AMBIENT_BY_TYPE = {
  Restroom: null,
  Equipment: "Storage.mp3",
  "Clean utility": "Storage.mp3",
  "Soiled utility": "Storage.mp3",
  Linen: "Storage.mp3",
  "Sterile core": "Surgery.mp3",
  Decontamination: "Surgery.mp3",
  "Prep and pack": "Surgery.mp3",
  "Sterile storage": "Surgery.mp3",
  "Ambulance bay": "Emergency&Trauma.mp3",
  "Resuscitation support": "Emergency&Trauma.mp3",
  "Stat lab": "Clinic.mp3",
};

function pickClip(room, list) {
  if (!list?.length) return null;
  let hash = 0;
  for (let i = 0; i < room.id.length; i += 1) {
    hash = (Math.imul(hash, 31) + room.id.charCodeAt(i)) >>> 0;
  }
  return list[hash % list.length];
}

function voiceForRoom(room) {
  if (room.type === "Med/Surg — Single") {
    return pickClip(room, room.dept === "surgward" ? VOICE.surgWard : VOICE.ward);
  }
  return pickClip(room, VOICES_BY_TYPE[room.type]);
}

function sfxForRoom(room) {
  if (SFX_BY_ROOM_ID[room.id]) return SFX_BY_ROOM_ID[room.id];
  const voice = voiceForRoom(room);
  if (voice) return voice;
  if (Object.prototype.hasOwnProperty.call(AMBIENT_BY_TYPE, room.type)) return AMBIENT_BY_TYPE[room.type];
  return SFX_BY_DEPARTMENT[room.dept] || null;
}

const NOTES = {
  overview: "Census for this floor is the card on the left. The plate stays on screen.",
  capacity: "Open beds are the available count. Surge fills Emergency and ICU first.",
  flow: "Every admit, floor move, OR case, discharge, and diversion.",
  staff: "Each occupied bed shows the attending and the primary nurse. The charge nurse covers the unit.",
  reports: "Counts come from the live census and the last 200 flow events.",
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
  if (name === "chat") {
    return (
      <svg {...common}>
        <path d="M5 6.5h14v9H8l-3 2.5V6.5z" />
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
  if (room?.heartRate == null) return null;
  const temp = room.temperature == null ? "—" : `${(room.temperature / 10).toFixed(1)}°C`;
  const pressure = room.systolic != null && room.diastolic != null
    ? `${room.systolic}/${room.diastolic}`
    : "—";
  return {
    hr: String(room.heartRate),
    bp: pressure,
    spo2: room.spo2 == null ? "—" : `${room.spo2}%`,
    rr: room.respiratoryRate == null ? "—" : String(room.respiratoryRate),
    temp,
  };
}

function historyFor(room, movements = []) {
  return (movements || [])
    .filter((item) => item.room_id === room.id || (room.patient && item.patient_name === room.patient))
    .slice(0, 12)
    .map((item) => {
      const stamp = item.created_at ? new Date(item.created_at) : null;
      const time = stamp && !Number.isNaN(stamp.getTime())
        ? stamp.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "—";
      const tag = item.patient_name && item.patient_name !== room.patient
        ? item.patient_name
        : "Census";
      return { time, text: item.message, tag };
    });
}

function minutesLeft(ticks) {
  if (ticks == null) return "—";
  if (ticks <= 0) return "Finished";
  const seconds = ticks * 9;
  if (seconds < 60) return "Under a minute";
  const minutes = Math.max(1, Math.round(seconds / 60));
  return minutes === 1 ? "About 1 min" : `About ${minutes} min`;
}

function severityWord(status) {
  if (status === "critical") return "Critical";
  if (status === "warning") return "Watch";
  return "Stable";
}

function dispositionFor(room, surgeOn) {
  if (room.needsOr) return "Needs OR";
  if (room.status === "critical" || room.status === "warning") return "Must stay";
  const emergency = room.dept === "ed" || room.dept === "trauma";
  if (emergency && surgeOn) return "Divert candidate";
  if (room.status === "normal") return "Ready for discharge";
  return "Must stay";
}

function cleaningBrief(room) {
  const cleanOpen = (room.ticksLeft ?? 1) > 0;
  const linenOut = Boolean(room.linenStage) && room.linenStage !== "ready";
  if (cleanOpen && linenOut) {
    return {
      why: "Cleaning is not finished, and soiled linen is still out.",
      owner: room.housekeeper || "Unassigned",
      ready: minutesLeft(Math.max(room.ticksLeft || 0, room.linenTicks || 0)),
    };
  }
  if (cleanOpen) {
    return {
      why: "Cleaning has not finished.",
      owner: room.housekeeper || "Unassigned",
      ready: minutesLeft(room.ticksLeft),
    };
  }
  if (linenOut) {
    return {
      why: "The clean is finished, but the bed stays closed until clean linen arrives.",
      owner: room.linenAide || "Linen",
      ready: minutesLeft(room.linenTicks),
    };
  }
  return {
    why: "Cleaning is finished. The bed is waiting to be opened.",
    owner: room.housekeeper || "Housekeeping",
    ready: "Now",
  };
}

function situationFor(room, floor) {
  if (!room.census) {
    return {
      band: "Support",
      tone: "is-support",
      why: `${room.type || room.deptLabel} on ${floor.name}. This is not an inpatient bed.`,
    };
  }
  if (room.patient) {
    const word = severityWord(room.status);
    return {
      band: "Occupied",
      detail: word,
      tone: room.status === "critical" ? "is-critical" : "is-occupied",
      why: `${room.patient} is ${word.toLowerCase()}. ${room.diagnosis || room.chiefComplaint || "Workup is in progress."}`,
    };
  }
  if (room.status === "cleaning") {
    const brief = cleaningBrief(room);
    const waiting = room.holdFor ? ` ${room.holdFor} is waiting for this bed.` : "";
    return {
      band: "Blocked",
      tone: "is-blocked",
      why: `${brief.why}${waiting}`,
      owner: brief.owner,
      ready: brief.ready,
    };
  }
  if (room.status === "reserved") {
    return {
      band: "Blocked",
      tone: "is-blocked",
      why: `Held for ${room.holdFor || "a patient"}. Not usable until the hold is released.`,
    };
  }
  if (room.status === "blocked") {
    return {
      band: "Blocked",
      tone: "is-blocked",
      why: "This bed is out of service.",
    };
  }
  return {
    band: "Usable",
    tone: "is-usable",
    why: "Open for the next patient.",
  };
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
  const [hospital, setHospital] = useState(() => buildHospital());
  const [incidents, setIncidents] = useState([]);
  const [ops, setOps] = useState(null);
  const [actionNote, setActionNote] = useState("");
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
  const [incomingNotice, setIncomingNotice] = useState("");
  const [calledPhysicians, setCalledPhysicians] = useState(0);
  const [divertedCount, setDivertedCount] = useState(0);
  const [transfers, setTransfers] = useState([]);
  const [roster, setRoster] = useState([]);
  const [movements, setMovements] = useState([]);
  const [flowLive, setFlowLive] = useState(false);
  const [flowSyncedAt, setFlowSyncedAt] = useState(null);
  const [flowNotice, setFlowNotice] = useState("");
  const [bellOpen, setBellOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [showBeds, setShowBeds] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [spaceFilter, setSpaceFilter] = useState("all");
  const [summaryOpen, setSummaryOpen] = useState(true);
  const [syncTick, setSyncTick] = useState(() => Date.now());
  const [zoom, setZoom] = useState(1.25);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fitToken, setFitToken] = useState(0);
  const mapRef = useRef(null);
  const sfxRef = useRef(null);
  const knownFlow = useRef(null);
  const reloadRef = useRef(async () => {});
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
  const badge = openIncidents.length;
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
        const [censusRes, transferRes, flowRes, staffRes, opsRes, incidentRes] = await Promise.all([
          fetch(apiUrl("/api/census")),
          fetch(apiUrl("/api/transfers")),
          fetch(apiUrl("/api/flow")),
          fetch(apiUrl("/api/staff")),
          fetch(apiUrl("/api/ops")),
          fetch(apiUrl("/api/incidents")),
        ]);
        if (stop) return;
        const census = censusRes.ok ? await censusRes.json() : null;
        const transferRows = transferRes.ok ? (await transferRes.json()).transfers || [] : [];
        const staffRows = staffRes.ok ? (await staffRes.json()).staff || [] : [];
        const flowBody = flowRes.ok ? await flowRes.json() : null;
        if (census) {
          setHospital((current) => applyCensus(current, census.rooms));
          setSurgeOn(Boolean(census.surge));
          setIncomingNotice(census.incoming_notice || "");
          setCalledPhysicians(census.called_physicians || 0);
          setDivertedCount(census.diverted_count || 0);
        }
        if (!stop) {
          setTransfers(transferRows);
          setRoster(staffRows);
        }
        if (flowBody && !stop) {
          setMovements(flowBody.events || []);
          setFlowLive(true);
          setFlowSyncedAt(Date.now());
        } else if (!stop) {
          setFlowLive(false);
        }
        if (!stop && opsRes.ok) {
          setOps(await opsRes.json());
        } else if (!stop && census) {
          setOps(buildLiveOps(census, transferRows, staffRows));
        }
        if (!stop && incidentRes.ok) {
          setIncidents((await incidentRes.json()).incidents || []);
        } else if (!stop && census) {
          setIncidents(incidentsFromCensus(census));
        }
      } catch {
        if (!stop) setFlowLive(false);
      }
    }

    pull();
    reloadRef.current = pull;
    const timer = setInterval(pull, 2000);
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
    if (nav !== "incidents" && nav !== "flow" && nav !== "capacity" && nav !== "reports" && nav !== "command" && nav !== "staff") setNav("live");
  }

  function playRoomSfx(id) {
    const room = floor.rooms.find((item) => item.id === id);
    if (!room) return;

    const filename = sfxForRoom(room);
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
    const boards = ["command", "capacity", "flow", "incidents", "reports", "staff"];
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

  async function runAction(path, body) {
    let res;
    try {
      res = await fetch(apiUrl(path), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new Error("The hospital did not answer. Make sure the server is on, then try again.");
    }
    const data = await res.json().catch(() => ({}));
    if (res.status === 404) {
      throw new Error("The live hospital answered, but this button is not on that server yet. The map and the numbers are live.");
    }
    if (!res.ok) {
      const detail = data.detail;
      throw new Error(typeof detail === "string" ? detail : "That did not save. Try again.");
    }
    await reloadRef.current();
    return data;
  }

  async function reportIncident(payload) {
    try {
      await runAction("/api/incidents", payload);
      setActionNote(`${payload.room_id} is blocked until the incident is resolved.`);
    } catch (error) {
      setActionNote(error.message);
    }
  }

  async function resolveIncident(incidentId) {
    if (typeof incidentId === "string" && incidentId.startsWith("census:")) {
      setActionNote("That bed is blocked on the live census. There is no incident record to close yet.");
      return;
    }
    const incident = incidents.find((item) => item.id === incidentId);
    try {
      const data = await runAction(`/api/incidents/${incidentId}/resolve`);
      setActionNote(`${data.room_id || incident?.room_id || "Room"} restored.`);
    } catch (error) {
      setActionNote(error.message);
    }
  }

  async function assignClean(roomId, housekeeperId) {
    try {
      await runAction(`/api/rooms/${roomId}/assign`, { housekeeper_id: housekeeperId });
      setActionNote(`${roomId} has someone cleaning it. Press “The bed is ready” when they finish.`);
    } catch (error) {
      setActionNote(error.message);
    }
  }

  async function completeClean(roomId) {
    try {
      const data = await runAction(`/api/rooms/${roomId}/clean/complete`, {});
      setActionNote(data.opened ? `${roomId} is ready for a patient. The open-bed number went up.` : data.reason);
    } catch (error) {
      setActionNote(error.message);
    }
  }

  function openOpsItem(item) {
    if (item.nav === "capacity") {
      chooseNav("capacity");
      return;
    }
    if (!item.room_id) return;
    for (const level of hospital) {
      const room = level.rooms.find((entry) => entry.id === item.room_id);
      if (room) {
        openHit({ floor: level, room });
        return;
      }
    }
  }

  function applyActionState(data) {
    if (data.rooms) setHospital((current) => applyCensus(current, data.rooms));
    setSurgeOn(Boolean(data.surge));
    setIncomingNotice(data.incoming_notice || "");
    setCalledPhysicians(data.called_physicians || 0);
    setDivertedCount(data.diverted_count || 0);
  }

  async function declareIncoming(notice) {
    if (surgeOn) return;
    try {
      const data = await runAction("/api/surge", { notice });
      applyActionState(data);
      setActionNote(
        data.admitted
          ? `The hospital heard you. ${data.admitted} very sick patients are arriving. Now call doctors or send people to another hospital.`
          : "The hospital heard you. Emergency has no open bed, so send patients to another hospital.",
      );
    } catch (error) {
      setActionNote(error.message);
    }
  }

  async function callPhysicians() {
    try {
      const data = await runAction("/api/surge/physicians");
      applyActionState(data);
      setActionNote(`${data.called} extra doctors are now at the hospital.`);
    } catch (error) {
      setActionNote(error.message);
    }
  }

  async function divertPatients() {
    try {
      const data = await runAction("/api/surge/divert");
      applyActionState(data);
      setActionNote(
        data.diverted
          ? `${data.diverted} patients went to County General. Those beds are free again.`
          : "There is nobody left in Emergency to send away.",
      );
    } catch (error) {
      setActionNote(error.message);
    }
  }

  async function resetDemo() {
    try {
      const data = await runAction("/api/demo/reset");
      applyActionState(data);
      setActionNote(`Start here: ${data.room_id} is dirty. Jordan Hale is waiting for that bed. Pick who cleans it, then press “The bed is ready”.`);
      setNav("command");
    } catch (error) {
      setActionNote(error.message);
    }
  }

  zoomRef.current = zoom;

  useLayoutEffect(() => {
    const stage = mapRef.current;
    if (!stage) return undefined;
    const frame = stage.querySelector(".map-canvas") || stage.querySelector(".map-body") || stage;
    let raf = 0;

    function fit() {
      const stageRect = frame.getBoundingClientRect();
      const width = stageRect.width;
      const height = stageRect.height;
      if (width < 48 || height < 48) return;
      const left = 18;
      const right = 18;
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
    }

    fit();
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    });
    observer.observe(frame);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [fitToken, selectedId, note]);

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
            onClick={() => setFlowNotice("")}
          >
            {flowNotice}
          </button>
        )}

        <div className="top-tools">
          <div className="bell-wrap">
            <button
              type="button"
              className="icon-btn"
              aria-label="Assistant"
              onClick={() => {
                setChatOpen((open) => !open);
                setBellOpen(false);
              }}
            >
              <Icon name="chat" />
            </button>
            <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} surgeOn={surgeOn} />
          </div>
          <div className="bell-wrap">
            <button
              type="button"
              className="icon-btn"
              aria-label="Alerts"
              onClick={() => {
                setBellOpen((open) => !open);
                setChatOpen(false);
              }}
            >
              <Icon name="bell" />
              {badge > 0 && <em>{badge}</em>}
            </button>
            {bellOpen && (
              <div className="bell-pop bell-list">
                <strong>Open incidents</strong>
                {openIncidents.length === 0 ? (
                  <p>No bed is blocked by an incident.</p>
                ) : (
                  openIncidents.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        setBellOpen(false);
                        openOpsItem({ nav: "live", room_id: item.room_id });
                      }}
                    >
                      <b>{item.room_id}</b>
                      <span>{item.title}</span>
                    </button>
                  ))
                )}
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

      <div className="workspace">
        <main className="stage">
          <div
            ref={mapRef}
            className={`map-stage${rightOpen ? " has-detail" : ""} is-live`}
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
                      className={elevatorOpen ? "live-btn is-on" : "live-btn"}
                      aria-expanded={elevatorOpen}
                      onClick={() => setElevatorOpen((open) => !open)}
                    >
                      Elevator
                    </button>
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
              onElevator={() => setElevatorOpen((open) => !open)}
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
            <div className="legend legend-status">
              {SPACE_FILTERS.filter((item) => item.dot).map((item) => (
                <span key={item.id}><i className="lg-dot" style={{ background: item.dot }} /> {item.label}</span>
              ))}
              <span><i className="lg lg-elev" /> Elevator</span>
              <span><i className="lg lg-stair" /> Stairs</span>
            </div>
            {toast && (
              <button type="button" className="toast" onClick={() => setToast("")}>
                {toast}
              </button>
            )}
            {elevatorOpen && (
              <>
                <button
                  type="button"
                  className="cab-backdrop"
                  aria-label="Close elevator"
                  onClick={() => setElevatorOpen(false)}
                />
                <ElevatorPanel
                  floors={hospital}
                  currentId={floor.id}
                  onSelect={goToFloor}
                  onClose={() => setElevatorOpen(false)}
                />
              </>
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
                    deptBeds={deptBeds}
                    staff={(ops?.staff && ops.staff.length ? ops.staff : roster)}
                    surgeOn={surgeOn}
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
        </main>
      </div>
    </div>
  );
}

const ROOM_TABS = [
  { id: "overview", label: "Situation" },
  { id: "patients", label: "Patient" },
  { id: "history", label: "Timeline" },
];

function lookupStaff(staff, name, roomId) {
  if (!name) return null;
  const person = (staff || []).find((item) => item.name === name);
  if (!person) return { name, detail: "Not on the roster", beds: [] };
  const duty = person.on_duty ? "On duty" : "Off duty";
  return {
    name,
    detail: `${person.specialty || person.role} · ${person.shift} shift · ${duty}`,
    beds: (person.patients || []).filter((id) => id !== roomId),
  };
}

function RoomCard({ room, floor, tab, onTab, deptBeds, staff = [], surgeOn = false, movements = [], onClose }) {
  const vitals = vitalsFor(room);
  const history = historyFor(room, movements);
  const occupied = Boolean(room.patient);
  const situation = situationFor(room, floor);
  const attending = lookupStaff(staff, room.physician, room.id);
  const nurse = lookupStaff(staff, room.nurse, room.id);
  const censusBeds = deptBeds.filter((item) => item.census);
  const openBeds = censusBeds.filter((item) => item.status === "available").length;
  const criticalBeds = censusBeds.filter((item) => item.status === "critical").length;

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
      </div>

      <div className="tabs">
        {ROOM_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? "is-on" : ""}
            onClick={() => onTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="sheet">
          <div className={`situation-band ${situation.tone}`}>
            <strong>{situation.band}{situation.detail ? ` · ${situation.detail}` : ""}</strong>
            <span>{situation.why}</span>
          </div>
          {situation.owner && <Meta label="Owner">{situation.owner}</Meta>}
          {situation.ready && <Meta label="Ready in">{situation.ready}</Meta>}
          {room.surge && room.census && (
            <Meta label="Incoming">Held for incoming casualties</Meta>
          )}
          {room.census && censusBeds.length > 0 && (
            <Meta label="Unit">
              {`${room.deptLabel}: ${openBeds} of ${censusBeds.length} beds open · ${criticalBeds} critical`}
            </Meta>
          )}
          {(attending || nurse || room.charge) && (
            <div className="team">
              <p className="kicker">Who is here</p>
              {attending && (
                <>
                  <p>Attending · {attending.name}</p>
                  <p>{attending.detail}</p>
                  {attending.beds.length > 0 && <p>Also covering {attending.beds.join(", ")}</p>}
                </>
              )}
              {nurse && (
                <>
                  <p>Primary nurse · {nurse.name}</p>
                  <p>{nurse.detail}</p>
                  {nurse.beds.length > 0 && <p>Also covering {nurse.beds.join(", ")}</p>}
                </>
              )}
              {room.charge && <p>Charge nurse · {room.charge}</p>}
            </div>
          )}
        </div>
      )}

      {tab === "patients" && (
        <div className="sheet">
          {occupied ? (
            <>
              <div className="detail-callout">
                <p className="kicker">{room.patient}{room.age != null ? ` · ${room.age} yrs` : ""}</p>
                <strong>{room.chiefComplaint || "Complaint not documented"}</strong>
                <span>{room.diagnosis || "Working diagnosis pending"}</span>
              </div>
              <Meta label="Acuity">{esiFor(room.status)}</Meta>
              <Meta label="Disposition">{dispositionFor(room, surgeOn)}</Meta>
              <Meta label="Attending">{attending ? `${attending.name} · ${attending.detail}` : "—"}</Meta>
              <Meta label="Primary nurse">{nurse ? `${nurse.name} · ${nurse.detail}` : "—"}</Meta>
              {vitals ? (
                <div className="detail-block">
                  <p className="kicker">Last recorded</p>
                  <div className="vital-grid">
                    <div><span>HR</span><strong>{vitals.hr}</strong></div>
                    <div><span>BP</span><strong>{vitals.bp}</strong></div>
                    <div><span>SpO₂</span><strong>{vitals.spo2}</strong></div>
                    <div><span>RR</span><strong>{vitals.rr}</strong></div>
                    <div><span>Temp</span><strong>{vitals.temp}</strong></div>
                  </div>
                </div>
              ) : (
                <p className="detail-copy">Vitals are not recorded.</p>
              )}
            </>
          ) : (
            <div className="detail-empty">
              <p className="kicker">{room.census ? "No patient assigned" : "Not a bed"}</p>
              <p className="detail-copy">{situation.why}</p>
            </div>
          )}
        </div>
      )}

      {tab === "history" && (
        <div className="sheet">
          <p className="kicker">Timeline</p>
          {history.length === 0 ? (
            <p className="detail-copy">No events recorded yet.</p>
          ) : (
            <ul className="activity">
              {history.map((item) => (
                <li key={`${item.time}-${item.text}`}>
                  <strong>{item.time}</strong>
                  <span>{item.text}</span>
                  <em>{item.tag}</em>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
