/** Packed floor plates in meters. Room area is width × depth. */

export const SITE = { w: 82, h: 66 };
export const FRAME = { x: 2.5, y: 1.6, w: 76, h: 62.4 };
export const BUILDING = { x: 4, y: 3, w: 72, h: 54 };

const GAP = 0.12;

export const CORE = [
  { id: "stair-w", kind: "stair", x: 32.2, y: 25.2, w: 3.6, h: 7.0, label: "Stairs" },
  { id: "stair-e", kind: "stair", x: 45.6, y: 25.2, w: 3.6, h: 7.0, label: "Stairs" },
  { id: "elev-a", kind: "elevator", cab: "patient", x: 36.2, y: 25.6, w: 2.7, h: 3.35, label: "A" },
  { id: "elev-b", kind: "elevator", cab: "patient", x: 39.1, y: 25.6, w: 2.7, h: 3.35, label: "B" },
  { id: "elev-s", kind: "elevator", cab: "service", x: 42.1, y: 25.5, w: 2.9, h: 3.5, label: "S" },
];

export const TREES = [
  { x: 2.1, y: 8 }, { x: 1.5, y: 24 }, { x: 2.3, y: 46 },
  { x: 79.6, y: 9 }, { x: 80.2, y: 30 }, { x: 79.2, y: 50 },
  { x: 16, y: 1.3 }, { x: 42, y: 1.2 }, { x: 64, y: 1.5 },
  { x: 20, y: 63.4 }, { x: 50, y: 63.6 }, { x: 70, y: 63.2 },
];

export const DEPT = {
  icu: { label: "Intensive Care", color: "#d7f6ea", ink: "#0f766e" },
  surgery: { label: "Surgery (OR)", color: "#e6edf6", ink: "#4a78b0" },
  imaging: { label: "Radiology", color: "#e6e2ff", ink: "#5b21b6" },
  ed: { label: "Emergency / Trauma", color: "#fde2e6", ink: "#be123c" },
  trauma: { label: "Emergency / Trauma", color: "#fecdd6", ink: "#9f1239" },
  med: { label: "Medical / Surgical", color: "#fff3cc", ink: "#a16207" },
  surgward: { label: "Surgical ward", color: "#ffedd5", ink: "#c2410c" },
  pacu: { label: "Recovery", color: "#fde68a", ink: "#92400e" },
  pharmacy: { label: "Pharmacy", color: "#e3f6cf", ink: "#3f6212" },
  waiting: { label: "Waiting", color: "#fbcfe8", ink: "#9d174d" },
  outpatient: { label: "Outpatient", color: "#e0e7ff", ink: "#3730a3" },
  support: { label: "Support", color: "#e6edf6", ink: "#4d5b77" },
  nurse: { label: "Staff Station", color: "#f4f7fb", ink: "#33415c" },
  spd: { label: "Sterile Processing", color: "#dde4ee", ink: "#33415c" },
  storage: { label: "Storage", color: "#fef3c7", ink: "#92400e" },
  morgue: { label: "Morgue", color: "#e7e5e4", ink: "#44403c" },
  mechanical: { label: "Mechanical", color: "#e2e8f0", ink: "#475569" },
  dock: { label: "Loading dock", color: "#dbeafe", ink: "#1e40af" },
  clinic: { label: "Clinic", color: "#e0e7ff", ink: "#3730a3" },
  admin: { label: "Administration", color: "#f8fafc", ink: "#334155" },
  conference: { label: "Conference", color: "#ede9fe", ink: "#5b21b6" },
};

export const STATUS = {
  critical: { label: "Critical", color: "#cf4b3e" },
  warning: { label: "Warning", color: "#cc8a2c" },
  normal: { label: "Normal", color: "#3f9142" },
  available: { label: "Available", color: "#2f8f86" },
  cleaning: { label: "Cleaning", color: "#6b7db5" },
  blocked: { label: "Blocked", color: "#7c3aed" },
};

const OCCUPIED = new Set(["critical", "warning", "normal"]);
const GIVEN = [
  "Sofia", "James", "Noah", "Amina", "Helen", "Mateo", "Grace", "Owen",
  "Priya", "Samuel", "Lila", "Jonah", "Emma", "Hugo", "Nora", "Eliot",
  "Clara", "Andre", "Maya", "Felix", "Camila", "Hassan", "Ruth", "Diego",
  "Imani", "Lars", "Yara", "Mei", "Paul", "Nina", "Omar", "Leah",
  "Victor", "Asha", "Elena", "Marcus", "Fatima", "Luis", "Hannah", "Kenji",
  "Amara", "Theo", "Rosa", "Daniel", "Ines", "Malik", "Chloe", "Ravi",
];
const FAMILY = [
  "Alvarez", "Whitfield", "Bennett", "Diallo", "Cho", "Ruiz", "Ibrahim", "Clarke",
  "Nair", "Ortiz", "Berg", "Abebe", "Walsh", "Ferreira", "Kim", "March",
  "Voss", "Blake", "Haddad", "Nguyen", "Brooks", "Petrov", "Okeke", "Tanaka",
  "Cohen", "Lang", "Reddy", "Santos", "Moreau", "Keller", "Okada", "Diaz",
];
const PATIENTS = (() => {
  const pool = [];
  const seen = new Set();
  const span = GIVEN.length * FAMILY.length;
  for (let index = 0; index < span; index += 1) {
    const given = GIVEN[index % GIVEN.length];
    const family = FAMILY[(index * 7) % FAMILY.length];
    let full = `${given} ${family}`;
    if (seen.has(full)) full = FAMILY.map((last) => `${given} ${last}`).find((name) => !seen.has(name));
    seen.add(full);
    pool.push(full);
  }
  return pool;
})();
const TEAMS = {
  icu: { physician: "Dr. Leena Patel", nurses: ["RN Maya Chen", "RN Chris Novak"], charge: "RN Adeyemi" },
  ed: { physician: "Dr. Jonah Okonkwo", nurses: ["RN Elena Brooks", "RN Jonah Blake"], charge: "RN Weiss" },
  med: { physician: "Dr. Amir Shah", nurses: ["RN Luis Ibarra", "RN Priya Raman"], charge: "RN Adeyemi" },
  surg: { physician: "Dr. Camila Alvarez", nurses: ["RN Priya Raman", "RN Luis Ibarra"], charge: "RN Weiss" },
};

let patientCursor = 0;

function area(w, h) {
  return Math.round(w * h * 10) / 10;
}

function activity(status, label) {
  if (status === "available") return [{ time: "09:40", text: "Bed marked ready", tag: "Housekeeping" }];
  if (status === "cleaning") return [{ time: "10:12", text: "Turnover in progress", tag: "Housekeeping" }];
  if (status === "critical") {
    return [
      { time: "10:18", text: `${label} acuity raised to critical`, tag: "Charge nurse" },
      { time: "09:02", text: "Attending at bedside", tag: "Physician" },
    ];
  }
  if (status === "warning") return [{ time: "09:48", text: "Vitals trending up", tag: "Nursing" }];
  return [{ time: "08:15", text: "Morning round complete", tag: "Nursing" }];
}

function zone(spec) {
  return {
    census: false,
    status: null,
    surge: false,
    patient: null,
    physician: null,
    nurse: null,
    kind: "zone",
    door: null,
    bed: null,
    bath: null,
    ...spec,
    area: area(spec.w, spec.h),
  };
}

function furnish(room, head) {
  const bed = {
    x: room.x + room.w / 2 - 0.48,
    y: room.y + (head === "s" ? room.h - 2.15 : 0.45),
    w: 0.96,
    h: Math.min(2.05, room.h - 0.9),
  };
  const doorEdge = head === "s" ? "n" : "s";
  return {
    bed,
    door: { edge: doorEdge, offset: 0.35, width: Math.min(1.22, room.w - 0.7) },
    bath:
      room.w >= 4 && room.h >= 5
        ? { x: room.x + room.w - 1.7, y: doorEdge === "s" ? room.y + room.h - 1.45 : room.y, w: 1.55, h: 1.35 }
        : null,
  };
}

function bedRoom(spec) {
  const status = spec.status;
  const occupied = OCCUPIED.has(status);
  const crew = TEAMS[spec.team || "med"];
  const furniture = furnish(spec, spec.head || "n");
  return {
    census: true,
    surge: false,
    kind: "bed",
    patient: occupied ? PATIENTS[patientCursor++ % PATIENTS.length] : null,
    physician: occupied ? crew.physician : null,
    nurse: occupied ? crew.nurses[(spec.nurseIndex || 0) % crew.nurses.length] : null,
    charge: crew.charge,
    door: furniture.door,
    bed: furniture.bed,
    bath: furniture.bath,
    ...spec,
    area: area(spec.w, spec.h),
    activity: activity(status, spec.id),
  };
}

function tile({
  x, y, cols, rows, w, h,
  prefix, start = 1,
  dept, deptLabel, type, team = "med",
  statuses, surge = false, census = true, head = "n", kind = "bed",
}) {
  const rooms = [];
  let n = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const rx = x + col * (w + GAP);
      const ry = y + row * (h + GAP);
      const num = start + n;
      const id = `${prefix}-${String(num).padStart(prefix.startsWith("ED") ? 2 : 3, "0").slice(-3)}`;
      const status = census ? statuses[n % statuses.length] : null;
      if (census) {
        rooms.push(bedRoom({
          id: prefix === "ED" || prefix === "ER" ? `${prefix}-${String(num).padStart(2, "0")}` : `${prefix}-${num}`,
          dept, deptLabel, type, team, status, surge, head, kind,
          nurseIndex: n,
          x: rx, y: ry, w, h,
        }));
      } else {
        rooms.push(zone({
          id: `${prefix}-${num}`,
          dept, deptLabel, type, kind,
          x: rx, y: ry, w, h,
          label: `${prefix}-${num}`,
        }));
      }
      n += 1;
    }
  }
  return rooms;
}

const MIX = ["normal", "available", "warning", "normal", "critical", "available", "cleaning", "normal", "available", "warning"];
const ICU = ["critical", "normal", "warning", "available", "normal", "critical", "available", "normal", "cleaning", "warning", "available", "normal"];
const ED = ["critical", "warning", "normal", "available", "critical", "available", "normal", "warning", "cleaning", "available", "normal", "available"];

function wc() {
  return [
    zone({ id: "WC-1", dept: "support", deptLabel: "Restroom", type: "Restroom", kind: "restroom", x: 50.2, y: 25.6, w: 2.3, h: 1.9, label: "WC" }),
    zone({ id: "WC-2", dept: "support", deptLabel: "Restroom", type: "Restroom", kind: "restroom", x: 50.2, y: 27.7, w: 2.3, h: 1.9, label: "WC" }),
  ];
}

function level(meta, rooms) {
  return { ...meta, rooms, corridors: [] };
}

function buildF3() {
  const rooms = [
    ...tile({
      x: 5.2, y: 3.8, cols: 6, rows: 2, w: 4.6, h: 5.4,
      prefix: "ICU", start: 301, dept: "icu", deptLabel: "Intensive Care",
      type: "ICU — Single", team: "icu", statuses: ICU, surge: true, head: "n",
    }),
    bedRoom({
      id: "OR-1", dept: "surgery", deptLabel: "Surgery (OR)", type: "Operating room", kind: "or",
      x: 36.2, y: 3.8, w: 7, h: 6.5, status: "warning", team: "surg", head: "n",
    }),
    bedRoom({
      id: "OR-2", dept: "surgery", deptLabel: "Surgery (OR)", type: "Operating room", kind: "or",
      x: 43.5, y: 3.8, w: 7, h: 6.5, status: "available", team: "surg", head: "n",
    }),
    zone({ id: "SCRUB", dept: "surgery", deptLabel: "Surgery (OR)", type: "Scrub", x: 50.8, y: 3.8, w: 6.6, h: 6.5, label: "Scrub" }),
    zone({ id: "CT", dept: "imaging", deptLabel: "Radiology", type: "CT suite", x: 58.2, y: 3.8, w: 7.6, h: 4.8, label: "CT" }),
    zone({ id: "MRI", dept: "imaging", deptLabel: "Radiology", type: "MRI suite", x: 66.1, y: 3.8, w: 8.4, h: 6.8, label: "MRI" }),
    zone({ id: "CTRL", dept: "imaging", deptLabel: "Radiology", type: "Control", x: 58.2, y: 8.8, w: 7.6, h: 3.4, label: "Control" }),
    zone({ id: "NS", dept: "nurse", deptLabel: "Staff Station", type: "Staff station", kind: "nurse", x: 20.5, y: 16.2, w: 10, h: 5.2, label: "Staff Station" }),
    zone({ id: "PHARM", dept: "pharmacy", deptLabel: "Pharmacy", type: "Pharmacy", x: 51.2, y: 16.4, w: 9.2, h: 6.2, label: "Pharmacy" }),
    bedRoom({
      id: "ER-T1", dept: "ed", deptLabel: "Emergency / Trauma", type: "ED — Trauma",
      x: 5.2, y: 16.2, w: 5.5, h: 4.6, status: "critical", team: "ed", surge: true, head: "n",
    }),
    bedRoom({
      id: "ER-T2", dept: "ed", deptLabel: "Emergency / Trauma", type: "ED — Trauma",
      x: 11.0, y: 16.2, w: 5.5, h: 4.6, status: "warning", team: "ed", surge: true, nurseIndex: 1, head: "n",
    }),
    ...tile({
      x: 5.2, y: 21.4, cols: 4, rows: 3, w: 3.4, h: 3.55,
      prefix: "ER", start: 1, dept: "ed", deptLabel: "Emergency / Trauma",
      type: "ED — Exam", team: "ed", statuses: ED, surge: true, head: "n",
    }),
    ...tile({
      x: 66.2, y: 16.2, cols: 2, rows: 4, w: 4.0, h: 4.15,
      prefix: "OP", start: 1, dept: "outpatient", deptLabel: "Outpatient",
      type: "Exam room", team: "med", statuses: MIX, census: false, head: "n",
    }),
    zone({ id: "STERILE", dept: "surgery", deptLabel: "Surgery (OR)", type: "Sterile core", x: 36.2, y: 11.2, w: 14, h: 4.2, label: "Sterile core" }),
    zone({ id: "SUPPLY", dept: "support", deptLabel: "Support", type: "Clean utility", x: 20.5, y: 26.4, w: 10, h: 4.6, label: "Clean / soiled" }),
    ...tile({
      x: 22.2, y: 39.6, cols: 8, rows: 2, w: 4.25, h: 5.5,
      prefix: "MS", start: 301, dept: "med", deptLabel: "Medical / Surgical",
      type: "Med/Surg — Single", team: "med", statuses: MIX, head: "s",
    }),
    zone({ id: "WAIT", dept: "waiting", deptLabel: "Waiting", type: "Waiting room", kind: "waiting", x: 5.2, y: 48.6, w: 15.5, h: 4, label: "Waiting" }),
    zone({ id: "LOCK", dept: "support", deptLabel: "Support", type: "Equipment", x: 58.2, y: 40.2, w: 12, h: 6.5, label: "Equipment" }),
    zone({ id: "LOUNGE", dept: "support", deptLabel: "Support", type: "Staff lounge", x: 58.2, y: 47.2, w: 12, h: 5.2, label: "Lounge" }),
    ...wc(),
  ];
  return level({
    id: "F3",
    code: "F3",
    name: "Floor 3",
    subtitle: "Acute care",
    charge: "RN Adeyemi",
    labels: [
      { x: 19.2, y: 9.6, text: "Intensive Care Unit (ICU)" },
      { x: 46.5, y: 7.4, text: "Surgery (OR)" },
      { x: 66.5, y: 8.2, text: "Radiology" },
      { x: 12.2, y: 28, text: "Emergency / Trauma" },
      { x: 39.5, y: 46.2, text: "Medical / Surgical Ward" },
      { x: 55.8, y: 19.6, text: "Pharmacy" },
      { x: 12.8, y: 50.8, text: "Waiting" },
      { x: 40.5, y: 29.2, text: "Staff Station" },
      { x: 70.2, y: 25, text: "Outpatient" },
    ],
  }, rooms);
}

function buildF2() {
  const rooms = [
    ...tile({
      x: 5.2, y: 3.8, cols: 12, rows: 1, w: 4.2, h: 6.4,
      prefix: "MED", start: 201, dept: "med", deptLabel: "Medicine",
      type: "Med/Surg — Single", team: "med", statuses: MIX, head: "n",
    }),
    ...tile({
      x: 5.2, y: 12.8, cols: 12, rows: 1, w: 4.2, h: 6.4,
      prefix: "MED", start: 213, dept: "med", deptLabel: "Medicine",
      type: "Med/Surg — Single", team: "med", statuses: MIX.slice().reverse(), head: "s",
    }),
    zone({ id: "M-NS", dept: "nurse", deptLabel: "Staff Station", type: "Nurse station", kind: "nurse", x: 20, y: 20.2, w: 10, h: 4.2, label: "Staff Station" }),
    zone({ id: "M-PH", dept: "pharmacy", deptLabel: "Pharmacy", type: "Floor pharmacy", x: 54, y: 20.2, w: 10, h: 5, label: "Pharmacy" }),
    zone({ id: "M-CLN", dept: "support", deptLabel: "Support", type: "Clean utility", x: 5.2, y: 20.2, w: 5, h: 2.4, label: "Clean" }),
    zone({ id: "M-SOL", dept: "support", deptLabel: "Support", type: "Soiled utility", x: 10.5, y: 20.2, w: 5, h: 2.4, label: "Soiled" }),
    zone({ id: "M-MEDS", dept: "support", deptLabel: "Support", type: "Medication room", x: 5.2, y: 23, w: 4.2, h: 2.1, label: "Meds" }),
    ...tile({
      x: 5.2, y: 36.5, cols: 8, rows: 2, w: 4.2, h: 5.2,
      prefix: "DAY", start: 1, dept: "support", deptLabel: "Support",
      type: "Support room", census: false,
    }),
    zone({ id: "M-WAIT", dept: "waiting", deptLabel: "Waiting", type: "Family waiting", kind: "waiting", x: 42, y: 36.5, w: 14, h: 5.5, label: "Family waiting" }),
    zone({ id: "M-PT", dept: "support", deptLabel: "Support", type: "PT gym", x: 42, y: 43, w: 16, h: 8.5, label: "PT gym" }),
    zone({ id: "M-ST", dept: "storage", deptLabel: "Storage", type: "Storage", x: 60, y: 36.5, w: 13, h: 14.5, label: "Storage" }),
    ...wc(),
  ];
  return level({
    id: "F2", code: "F2", name: "Floor 2", subtitle: "Medicine", charge: "RN Adeyemi",
    labels: [
      { x: 32, y: 8.4, text: "Medicine — north rooms" },
      { x: 32, y: 16.4, text: "Medicine — corridor side" },
      { x: 25, y: 22.4, text: "Staff Station" },
      { x: 59, y: 22.8, text: "Pharmacy" },
      { x: 22, y: 42, text: "Support" },
      { x: 49, y: 40, text: "Family waiting" },
    ],
  }, rooms);
}

function buildF4() {
  const rooms = [
    ...tile({
      x: 5.2, y: 3.8, cols: 12, rows: 1, w: 4.2, h: 6.4,
      prefix: "SUR", start: 401, dept: "surgward", deptLabel: "Surgical ward",
      type: "Med/Surg — Single", team: "surg", statuses: MIX, head: "n",
    }),
    ...tile({
      x: 5.2, y: 12.8, cols: 12, rows: 1, w: 4.2, h: 6.4,
      prefix: "SUR", start: 413, dept: "surgward", deptLabel: "Surgical ward",
      type: "Med/Surg — Single", team: "surg", statuses: MIX.slice().reverse(), head: "s",
    }),
    zone({ id: "PACU", dept: "pacu", deptLabel: "Recovery", type: "Post-anesthesia recovery", x: 54, y: 20.4, w: 16, h: 5, label: "PACU 80 m²" }),
    zone({ id: "S-NS", dept: "nurse", deptLabel: "Staff Station", type: "Nurse station", kind: "nurse", x: 20, y: 20.4, w: 12, h: 4.4, label: "Staff Station" }),
    zone({ id: "S-WAIT", dept: "waiting", deptLabel: "Waiting", type: "Family waiting", kind: "waiting", x: 5.2, y: 36, w: 16, h: 6, label: "Waiting" }),
    ...tile({
      x: 24, y: 36, cols: 6, rows: 2, w: 4.3, h: 5.4,
      prefix: "REC", start: 1, dept: "support", deptLabel: "Support", type: "Support room", census: false,
    }),
    zone({ id: "S-ST", dept: "storage", deptLabel: "Storage", type: "Storage", x: 54, y: 40, w: 16, h: 10, label: "Storage" }),
    ...wc(),
  ];
  return level({
    id: "F4", code: "F4", name: "Floor 4", subtitle: "Surgical ward", charge: "RN Weiss",
    labels: [
      { x: 32, y: 8, text: "Surgical ward" },
      { x: 32, y: 16.2, text: "Post-op rooms" },
      { x: 62, y: 23, text: "Recovery (PACU)" },
      { x: 26, y: 22.6, text: "Staff Station" },
      { x: 13, y: 39, text: "Waiting" },
    ],
  }, rooms);
}

function buildF1() {
  const rooms = [
    bedRoom({
      id: "ED-T1", dept: "ed", deptLabel: "Emergency / Trauma", type: "ED — Trauma",
      x: 5.2, y: 3.8, w: 5.5, h: 4.6, status: "critical", team: "ed", surge: true,
    }),
    bedRoom({
      id: "ED-T2", dept: "ed", deptLabel: "Emergency / Trauma", type: "ED — Trauma",
      x: 11, y: 3.8, w: 5.5, h: 4.6, status: "warning", team: "ed", surge: true, nurseIndex: 1,
    }),
    ...tile({
      x: 5.2, y: 9.2, cols: 6, rows: 2, w: 3.4, h: 3.6,
      prefix: "ED", start: 1, dept: "ed", deptLabel: "Emergency / Trauma",
      type: "ED — Exam", team: "ed", statuses: ED, surge: true,
    }),
    zone({ id: "F1-CT", dept: "imaging", deptLabel: "Radiology", type: "CT suite", x: 46, y: 3.8, w: 8, h: 5.2, label: "CT" }),
    zone({ id: "F1-XR", dept: "imaging", deptLabel: "Radiology", type: "X-ray", x: 54.5, y: 3.8, w: 8, h: 5.2, label: "X-ray" }),
    zone({ id: "F1-NS", dept: "nurse", deptLabel: "Staff Station", type: "Nurse station", kind: "nurse", x: 20, y: 18.5, w: 10, h: 4.5, label: "Staff Station" }),
    zone({ id: "EMS", dept: "support", deptLabel: "EMS bay", type: "Ambulance bay", x: 5.2, y: 22, w: 14, h: 8, label: "EMS bay" }),
    zone({ id: "TRI", dept: "ed", deptLabel: "Emergency / Trauma", type: "Triage", x: 46, y: 12, w: 4.2, h: 3.2, label: "Triage" }),
    zone({ id: "REG", dept: "support", deptLabel: "Registration", type: "Registration", x: 51, y: 12, w: 8, h: 4, label: "Registration" }),
    zone({ id: "F1-WAIT", dept: "waiting", deptLabel: "Waiting", type: "Waiting room", kind: "waiting", x: 22, y: 46, w: 16, h: 3.75, label: "Waiting" }),
    ...tile({
      x: 5.2, y: 36, cols: 5, rows: 2, w: 3.6, h: 4,
      prefix: "FAST", start: 1, dept: "ed", deptLabel: "Emergency / Trauma",
      type: "Fast track", team: "ed", statuses: MIX, surge: true,
    }),
    ...tile({
      x: 24.6, y: 36, cols: 4, rows: 2, w: 4.15, h: 4.1,
      prefix: "OBS", start: 1, dept: "ed", deptLabel: "Emergency / Trauma",
      type: "Observation", team: "ed", statuses: MIX, surge: true,
    }),
    zone({ id: "F1-RES", dept: "support", deptLabel: "Support", type: "Resuscitation support", x: 46, y: 36, w: 14, h: 8, label: "Resuscitation" }),
    zone({ id: "F1-LAB", dept: "support", deptLabel: "Support", type: "Stat lab", x: 62, y: 36, w: 10, h: 8, label: "Stat lab" }),
    ...wc(),
  ];
  return level({
    id: "F1", code: "F1", name: "Floor 1", subtitle: "Emergency", charge: "RN Weiss",
    labels: [
      { x: 18, y: 14, text: "Emergency / Trauma" },
      { x: 54, y: 6.6, text: "Imaging" },
      { x: 12, y: 26, text: "EMS bay" },
      { x: 30, y: 48, text: "Waiting" },
      { x: 25, y: 20.8, text: "Staff Station" },
    ],
  }, rooms);
}

function buildF5() {
  const rooms = [
    ...tile({
      x: 5.2, y: 3.8, cols: 10, rows: 2, w: 3.3, h: 3.7,
      prefix: "CL", start: 501, dept: "clinic", deptLabel: "Clinic", type: "Exam room", census: false,
    }),
    ...tile({
      x: 5.2, y: 42, cols: 10, rows: 2, w: 3.3, h: 3.7,
      prefix: "CL", start: 521, dept: "clinic", deptLabel: "Clinic", type: "Exam room", census: false,
    }),
    zone({ id: "DIR", dept: "admin", deptLabel: "Administration", type: "Medical director", x: 5.2, y: 16, w: 7, h: 5, label: "Director" }),
    zone({ id: "CONF", dept: "conference", deptLabel: "Conference", type: "Conference", x: 13, y: 16, w: 12, h: 6.5, label: "Conference" }),
    zone({ id: "BOARD", dept: "conference", deptLabel: "Conference", type: "Board room", x: 54, y: 16, w: 16, h: 7, label: "Board" }),
    zone({ id: "ADMIN", dept: "admin", deptLabel: "Administration", type: "Open office", x: 54, y: 24, w: 16, h: 8, label: "Administration" }),
    zone({ id: "CWAIT", dept: "waiting", deptLabel: "Waiting", type: "Clinic waiting", kind: "waiting", x: 20, y: 34, w: 16, h: 6, label: "Waiting" }),
    ...wc(),
  ];
  return level({
    id: "F5", code: "F5", name: "Floor 5", subtitle: "Clinics and administration", charge: null,
    labels: [
      { x: 22, y: 8, text: "Clinics" },
      { x: 22, y: 46, text: "Clinics" },
      { x: 19, y: 19, text: "Conference" },
      { x: 62, y: 19.5, text: "Board" },
      { x: 62, y: 28, text: "Administration" },
      { x: 28, y: 37, text: "Waiting" },
    ],
  }, rooms);
}

function buildB1() {
  const rooms = [
    zone({ id: "SPD-1", dept: "spd", deptLabel: "Sterile Processing", type: "Decontamination", x: 5.2, y: 3.8, w: 12, h: 8, label: "Decontam" }),
    zone({ id: "SPD-2", dept: "spd", deptLabel: "Sterile Processing", type: "Prep and pack", x: 17.5, y: 3.8, w: 14, h: 8, label: "Prep" }),
    zone({ id: "SPD-3", dept: "spd", deptLabel: "Sterile Processing", type: "Sterile storage", x: 5.2, y: 12.2, w: 10, h: 7.2, label: "Sterile store" }),
    zone({ id: "MECH", dept: "mechanical", deptLabel: "Mechanical", type: "Mechanical", x: 54, y: 3.8, w: 18, h: 14, label: "Mechanical" }),
    zone({ id: "STOR", dept: "storage", deptLabel: "Storage", type: "General stores", x: 5.2, y: 36, w: 18, h: 12, label: "Stores" }),
    zone({ id: "MOR", dept: "morgue", deptLabel: "Morgue", type: "Body holding", x: 24.5, y: 38, w: 5, h: 4, label: "Morgue" }),
    zone({ id: "LIN", dept: "support", deptLabel: "Support", type: "Linen", x: 54, y: 36, w: 14, h: 8, label: "Linen" }),
    zone({ id: "DOCK", dept: "dock", deptLabel: "Loading dock", type: "Loading dock", x: 36, y: 46, w: 24, h: 7.5, label: "Loading dock" }),
    ...wc(),
  ];
  return level({
    id: "B1", code: "B1", name: "Basement", subtitle: "Support services", charge: null,
    labels: [
      { x: 20, y: 8, text: "Sterile processing" },
      { x: 63, y: 11, text: "Mechanical" },
      { x: 14, y: 42, text: "Stores" },
      { x: 27, y: 40, text: "Morgue" },
      { x: 61, y: 40, text: "Linen" },
      { x: 48, y: 50, text: "Loading dock" },
    ],
  }, rooms);
}

export function buildHospital() {
  patientCursor = 0;
  return [buildF5(), buildF4(), buildF3(), buildF2(), buildF1(), buildB1()];
}

export function summarize(floor) {
  const beds = floor.rooms.filter((room) => room.census);
  const seen = new Map();
  for (const room of floor.rooms) {
    if (!room.dept || room.kind === "restroom") continue;
    const current = seen.get(room.dept) || {
      id: room.dept,
      label: DEPT[room.dept]?.label || room.deptLabel,
      color: DEPT[room.dept]?.ink || "#59627e",
      beds: 0,
      rooms: 0,
    };
    current.rooms += 1;
    if (room.census) current.beds += 1;
    seen.set(room.dept, current);
  }
  return {
    total: beds.length,
    available: beds.filter((room) => room.status === "available").length,
    occupied: beds.filter((room) => OCCUPIED.has(room.status)).length,
    critical: beds.filter((room) => room.status === "critical").length,
    cleaning: beds.filter((room) => room.status === "cleaning").length,
    departments: [...seen.values()],
    amenities: [
      { id: "elev", label: "Elevators", count: 3 },
      { id: "stairs", label: "Stairs", count: 2 },
      { id: "rest", label: "Restrooms", count: floor.rooms.filter((room) => room.kind === "restroom").length },
      { id: "wait", label: "Waiting areas", count: floor.rooms.filter((room) => room.kind === "waiting").length },
    ],
  };
}

export function findRooms(hospital, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const hits = [];
  for (const floor of hospital) {
    for (const room of floor.rooms) {
      const blob = `${room.id} ${room.deptLabel} ${room.type} ${room.patient || ""} ${room.chiefComplaint || ""} ${room.diagnosis || ""}`.toLowerCase();
      if (blob.includes(needle)) hits.push({ floor, room });
    }
  }
  return hits.slice(0, 8);
}

const OCCUPIED_STATUS = new Set(["critical", "warning", "normal"]);

export function applyCensus(hospital, rooms) {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  return hospital.map((floor) => ({
    ...floor,
    rooms: floor.rooms.map((room) => {
      const live = byId.get(room.id);
      if (!live) return room;
      const occupied = OCCUPIED_STATUS.has(live.status);
      return {
        ...room,
        status: live.status,
        patient: occupied ? live.patient : null,
        physician: occupied ? live.physician : null,
        nurse: occupied ? live.nurse : null,
        acuity: occupied ? live.acuity || live.status : null,
        needsOr: occupied ? Boolean(live.needs_or) : false,
        age: occupied ? live.age ?? null : null,
        chiefComplaint: occupied ? live.chief_complaint || null : null,
        diagnosis: occupied ? live.diagnosis || null : null,
      };
    }),
  }));
}

function unusedName(used) {
  const name = PATIENTS.find((candidate) => !used.has(candidate));
  used.add(name);
  return name;
}

export function applySurge(hospital) {
  let flipped = 0;
  const used = new Set(hospital.flatMap((floor) => floor.rooms.map((room) => room.patient).filter(Boolean)));
  const next = hospital.map((floor) => {
    if (floor.id !== "F1" && floor.id !== "F3") return floor;
    return {
      ...floor,
      rooms: floor.rooms.map((room) => {
        if (!room.census || !room.surge || room.status !== "available") return room;
        flipped += 1;
        const crew = room.dept === "icu" ? TEAMS.icu : TEAMS.ed;
        return {
          ...room,
          status: "critical",
          patient: unusedName(used),
          physician: crew.physician,
          nurse: crew.nurses[0],
          activity: [
            { time: "10:24", text: "Assigned from train collision surge", tag: "Command" },
            { time: "10:24", text: "Bed held for incoming critical", tag: "Charge nurse" },
          ],
        };
      }),
    };
  });
  return { hospital: next, flipped };
}

function hits(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0.05 && h > 0.05;
}

export function audit(hospital) {
  const problems = [];
  const inner = { x: 4.4, y: 3.4, w: 71.2, h: 53.2 };
  for (const floor of hospital) {
    const shapes = [...floor.rooms, ...CORE];
    for (let i = 0; i < shapes.length; i += 1) {
      const a = shapes[i];
      if (a.x < inner.x - 0.05 || a.y < inner.y - 0.05 || a.x + a.w > inner.x + inner.w + 0.15 || a.y + a.h > inner.y + inner.h + 0.15) {
        problems.push(`${floor.id} ${a.id} outside plate`);
      }
      for (let j = i + 1; j < shapes.length; j += 1) {
        const b = shapes[j];
        if (hits(a, b)) problems.push(`${floor.id} ${a.id || "core"} overlaps ${b.id || "core"}`);
      }
    }
  }
  return problems;
}
