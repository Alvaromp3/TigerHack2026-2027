// Clinical scores, bed forecasts, and the ranked "next best action" list.
// Everything here is derived from the live census; nothing is invented.

export const TICK_SECONDS = 9; // backend/app/sim.py
export const NURSE_LOAD = 4; // backend/app/ops_snapshot.py
export const STAY_BOARD = 12; // backend/app/sim.py: stable patients can leave after this many ticks
export const FORECAST_MIN = 15;

const OCCUPIED = new Set(["critical", "warning", "normal"]);

export function stayLabel(ticks) {
  if (ticks == null) return null;
  const minutes = Math.round((ticks * TICK_SECONDS) / 60);
  if (minutes < 1) return "Just arrived";
  if (minutes < 60) return `${minutes} min in bed`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min in bed`;
}

// Simplified NEWS2 from the last recorded vitals (no consciousness or O2 terms).
export function earlyWarning(room) {
  if (room?.heartRate == null) return null;
  const rows = [];
  const rr = room.respiratoryRate;
  const spo2 = room.spo2;
  const sbp = room.systolic;
  const hr = room.heartRate;
  const temp = room.temperature == null ? null : room.temperature / 10;
  if (rr != null) rows.push({ label: "RR", value: rr, score: rr <= 8 ? 3 : rr <= 11 ? 1 : rr <= 20 ? 0 : rr <= 24 ? 2 : 3 });
  if (spo2 != null) rows.push({ label: "SpO₂", value: `${spo2}%`, score: spo2 <= 91 ? 3 : spo2 <= 93 ? 2 : spo2 <= 95 ? 1 : 0 });
  if (sbp != null) {
    rows.push({
      label: "BP",
      value: `${sbp}/${room.diastolic ?? "—"}`,
      score: sbp <= 90 ? 3 : sbp <= 100 ? 2 : sbp <= 110 ? 1 : sbp <= 219 ? 0 : 3,
    });
  }
  rows.push({ label: "HR", value: hr, score: hr <= 40 ? 3 : hr <= 50 ? 1 : hr <= 90 ? 0 : hr <= 110 ? 1 : hr <= 130 ? 2 : 3 });
  if (temp != null) {
    rows.push({
      label: "Temp",
      value: `${temp.toFixed(1)}°`,
      score: temp <= 35 ? 3 : temp <= 36 ? 1 : temp <= 38 ? 0 : temp <= 39 ? 1 : 2,
    });
  }
  const total = rows.reduce((sum, row) => sum + row.score, 0);
  const level = total >= 7 ? "high" : total >= 5 || rows.some((row) => row.score === 3) ? "medium" : "low";
  const advice = {
    high: "Emergency response. Continuous monitoring.",
    medium: "Urgent review by the attending.",
    low: "Routine observation.",
  }[level];
  return { total, level, advice, rows };
}

// Seconds until a bed in turnover opens: clean, then linen, plus a wait if nobody is on it yet.
export function cleanEtaSeconds(room) {
  if (room?.status !== "cleaning") return null;
  const clean = Math.max(0, room.ticksLeft ?? 4);
  const linen = room.linenStage && room.linenStage !== "ready" ? Math.max(1, room.linenTicks ?? 2) : 0;
  const queue = !room.housekeeper && clean > 0 ? 3 : 0;
  return (queue + clean + linen) * TICK_SECONDS;
}

export function formatEta(seconds) {
  if (seconds == null) return "—";
  if (seconds <= 0) return "now";
  if (seconds < 60) return `${Math.max(5, Math.round(seconds / 5) * 5)}s`;
  return `${Math.round(seconds / 60)}m`;
}

function isDischargeCandidate(room) {
  if (!room.patient || room.status !== "normal" || room.needsOr) return false;
  if (room.dept === "icu" || room.dept === "surgery" || room.kind === "or") return false;
  const warning = earlyWarning(room);
  if (warning && warning.total > 2) return false;
  return room.stayTicks == null || room.stayTicks >= STAY_BOARD;
}

export function censusRooms(hospital) {
  return hospital.flatMap((level) =>
    level.rooms.filter((room) => room.census).map((room) => ({ ...room, floorId: level.id, floorCode: level.code })),
  );
}

export function forecast(rooms) {
  const horizon = FORECAST_MIN * 60;
  const open = rooms.filter((room) => room.status === "available").length;
  const cleans = rooms.filter((room) => {
    const eta = cleanEtaSeconds(room);
    return eta != null && eta <= horizon;
  }).length;
  const candidates = rooms.filter(isDischargeCandidate).length;
  // Conservative: about a third of the stable patients who could leave do so inside the window.
  const discharges = Math.min(8, Math.round(candidates * 0.3));
  return {
    now: open,
    soon: open + cleans + discharges,
    cleans,
    discharges,
    candidates,
    horizon: FORECAST_MIN,
  };
}

function shortName(name) {
  const parts = String(name || "").trim().split(/\s+/);
  return parts.length < 2 ? parts[0] || "" : `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// Ranked to-do list for the charge nurse. Each item says what it gains and what one click does.
export function buildActions({ rooms, ops, surgeOn, calledPhysicians, incidents }) {
  const list = [];
  const open = rooms.filter((room) => room.status === "available").length;
  const critical = rooms.filter((room) => room.status === "critical").length;
  const edPatients = rooms.filter((room) => (room.dept === "ed" || room.dept === "trauma") && OCCUPIED.has(room.status)).length;
  const staff = ops?.staff || [];
  const overloaded = staff
    .filter((person) => person.role === "nurse" && person.on_duty && (person.patients || []).length > NURSE_LOAD)
    .sort((a, b) => b.patients.length - a.patients.length);

  if (surgeOn && !calledPhysicians) {
    list.push({
      id: "call",
      priority: 100,
      tone: "crit",
      title: "Call in off-duty physicians",
      detail: `${critical} critical patients in house${overloaded.length ? ` · ${overloaded.length} ${overloaded.length === 1 ? "nurse" : "nurses"} over safe load` : ""}.`,
      gain: "More hands",
      run: { kind: "call", label: "Call now" },
    });
  }

  if (surgeOn && open <= 1 && edPatients > 0) {
    list.push({
      id: "divert",
      priority: 95,
      tone: "crit",
      title: "Divert Emergency overflow",
      detail: `${open === 0 ? "No open bed" : "One open bed"} left in the hospital. Send stable ED patients to County General.`,
      gain: "Frees ED beds",
      run: { kind: "divert", label: "Divert" },
    });
  }

  for (const room of rooms) {
    if (room.status === "cleaning" && room.ticksLeft === 0 && (!room.linenStage || room.linenStage === "ready")) {
      list.push({
        id: `open:${room.id}`,
        priority: 92,
        tone: "ok",
        title: `Open ${room.id}`,
        detail: `Clean and linen are done on ${room.floorCode}${room.holdFor ? `. ${room.holdFor} is waiting` : ""}.`,
        gain: "+1 bed now",
        roomId: room.id,
        run: { kind: "complete", roomId: room.id, label: "Open bed" },
      });
    }
  }

  const freeKeepers = (ops?.housekeepers || []).filter((keeper) => !keeper.room_id);
  const waiting = rooms
    .filter((room) => room.status === "cleaning" && !room.housekeeper && (room.ticksLeft ?? 1) > 0)
    .map((room) => ({
      room,
      score: (room.holdFor ? 10 : 0) + (room.dept === "ed" || room.dept === "icu" || room.dept === "trauma" ? 6 : 0) + (room.cleanPriority || 0),
    }))
    .sort((a, b) => b.score - a.score);
  waiting.slice(0, Math.min(2, freeKeepers.length)).forEach(({ room, score }, index) => {
    const keeper = freeKeepers[index];
    list.push({
      id: `assign:${room.id}`,
      priority: 84 + Math.min(score, 10),
      tone: "clean",
      title: `Send ${keeper.name} to clean ${room.id}`,
      detail: room.holdFor
        ? `${room.holdFor} is waiting for this bed.`
        : `Nobody is on this clean yet (${room.deptLabel}, ${room.floorCode}).`,
      gain: `+1 bed in ~${formatEta(cleanEtaSeconds({ ...room, housekeeper: keeper.name }))}`,
      roomId: room.id,
      run: { kind: "assign", roomId: room.id, keeperId: keeper.id, label: "Assign" },
    });
  });

  rooms
    .filter(isDischargeCandidate)
    .sort((a, b) => (b.stayTicks || 0) - (a.stayTicks || 0))
    .slice(0, 2)
    .forEach((room) => {
      const warning = earlyWarning(room);
      list.push({
        id: `discharge:${room.id}`,
        priority: surgeOn ? 88 : 72,
        tone: "occ",
        title: `Discharge ${shortName(room.patient)} from ${room.id}`,
        detail: `Stable${warning ? ` · NEWS ${warning.total}` : ""}${room.stayTicks != null ? ` · ${stayLabel(room.stayTicks)}` : ""}.`,
        gain: "+1 bed after turnover",
        roomId: room.id,
        run: { kind: "discharge", roomId: room.id, label: "Discharge" },
      });
    });

  if (overloaded.length) {
    const nurse = overloaded[0];
    list.push({
      id: `load:${nurse.id}`,
      priority: surgeOn ? 80 : 66,
      tone: "warn",
      title: `${nurse.name} covers ${nurse.patients.length} patients`,
      detail: `Safe load is ${NURSE_LOAD}.${overloaded.length > 1 ? ` ${overloaded.length - 1} more nurses are over it.` : ""}`,
      gain: "Safer care",
      roomId: nurse.patients[0],
      run: surgeOn && !calledPhysicians ? { kind: "call", label: "Call help" } : null,
    });
  }

  for (const incident of incidents || []) {
    if (typeof incident.id === "string") continue;
    list.push({
      id: `incident:${incident.id}`,
      priority: 60,
      tone: "warn",
      title: `Clear incident on ${incident.room_id}`,
      detail: incident.title,
      gain: "+1 bed",
      roomId: incident.room_id,
      run: { kind: "resolve", incidentId: incident.id, label: "Resolve" },
    });
  }

  return list.sort((a, b) => b.priority - a.priority).slice(0, 5);
}
