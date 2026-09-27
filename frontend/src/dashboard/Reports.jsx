import { useMemo, useState } from "react";
import { flowBucket } from "./flowBuckets";

const KINDS = [
  { id: "admit", label: "Admits" },
  { id: "move", label: "Transfers" },
  { id: "or", label: "OR cases" },
  { id: "discharge", label: "Discharges" },
  { id: "divert", label: "Diversions" },
  { id: "turnover", label: "Rooms opened" },
];

const OPEN_STATUS = new Set(["cleaning", "blocked", "reserved"]);

function shiftLabel(date) {
  const hour = date.getHours();
  if (hour >= 7 && hour < 15) return "Day · 07:00–15:00";
  if (hour >= 15 && hour < 23) return "Evening · 15:00–23:00";
  return "Night · 23:00–07:00";
}

function censusBeds(hospital) {
  const rows = [];
  for (const floor of hospital) {
    for (const room of floor.rooms) {
      if (!room.census) continue;
      rows.push({
        ...room,
        floorId: floor.id,
        floorCode: floor.code,
        floorName: floor.name,
      });
    }
  }
  return rows;
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export default function Reports({ hospital, movements, incidents = [], flowLive, syncedAt, onOpenRoom }) {
  const [floorId, setFloorId] = useState("all");
  const now = new Date();
  const beds = useMemo(() => censusBeds(hospital), [hospital]);
  const roomFloor = useMemo(() => {
    const map = new Map();
    for (const room of beds) map.set(room.id, room.floorId);
    return map;
  }, [beds]);
  const scopedBeds = floorId === "all" ? beds : beds.filter((room) => room.floorId === floorId);
  const scopedEvents = useMemo(() => {
    if (floorId === "all") return movements;
    return movements.filter((item) => !item.room_id || roomFloor.get(item.room_id) === floorId);
  }, [movements, floorId, roomFloor]);

  const usable = scopedBeds.filter((room) => room.status === "available").length;
  const cleaning = scopedBeds.filter((room) => room.status === "cleaning").length;
  const blocked = scopedBeds.filter((room) => room.status === "blocked").length;
  const reserved = scopedBeds.filter((room) => room.status === "reserved").length;
  const incidentByRoom = new Map(
    incidents.filter((item) => item.status === "open").map((item) => [item.room_id, item]),
  );
  const floors = hospital.map((floor) => {
    const rooms = beds.filter((room) => room.floorId === floor.id);
    const open = rooms.filter((room) => room.status === "available").length;
    const busy = rooms.filter((room) => ["critical", "warning", "normal"].includes(room.status)).length;
    const waiting = rooms.filter((room) => OPEN_STATUS.has(room.status)).length;
    return {
      id: floor.id,
      code: floor.code,
      name: floor.name,
      total: rooms.length,
      open,
      busy,
      waiting,
    };
  }).filter((floor) => floor.total > 0);

  const kindCounts = KINDS.map((kind) => ({
    ...kind,
    value: scopedEvents.filter((item) => flowBucket(item) === kind.id).length,
  }));
  const openWork = scopedBeds
    .filter((room) => OPEN_STATUS.has(room.status))
    .sort((a, b) => a.floorCode.localeCompare(b.floorCode) || a.id.localeCompare(b.id));

  const synced = syncedAt
    ? new Date(syncedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" })
    : null;

  function exportCsv() {
    const lines = [
      ["floor", "room", "status", "department", "block"].map(csvCell).join(","),
      ...openWork.map((room) => [
        room.floorCode,
        room.id,
        room.status,
        room.deptLabel,
        room.status === "cleaning"
          ? (room.housekeeper ? `Assigned to ${room.housekeeper}` : "Waiting for housekeeping")
          : room.status === "reserved"
            ? (room.holdFor ? `Reserved for ${room.holdFor}` : "Reserved")
            : (incidentByRoom.get(room.id)?.title || "Out of service"),
      ].map(csvCell).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "open-work.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="reports-page" aria-label="Reports">
      <header className="reports-head">
        <div>
          <p className="kicker">Logistics</p>
          <h2>Reports</h2>
          <p>Census is the current plate. Movement counts use the last {movements.length || 0} flow events.</p>
        </div>
        <div className="reports-tools">
          <label>
            Floor
            <select value={floorId} onChange={(event) => setFloorId(event.target.value)} aria-label="Report floor">
              <option value="all">All floors</option>
              {floors.map((floor) => (
                <option key={floor.id} value={floor.id}>{floor.code} · {floor.name}</option>
              ))}
            </select>
          </label>
          <span>{shiftLabel(now)}</span>
          <button type="button" onClick={exportCsv} disabled={openWork.length === 0}>Export open work</button>
        </div>
      </header>

      <p className="reports-source">
        Period: {shiftLabel(now)}. Source: live census{flowLive ? "" : " (flow log not connected)"}
        {synced ? ` · last sync ${synced}` : ""}.
        Usable beds = census beds with status available. A clean that has not finished has no duration.
      </p>

      <div className="reports-metrics">
        <article>
          <span>Usable</span>
          <strong>{usable}</strong>
          <small>of {scopedBeds.length} census beds</small>
        </article>
        <article>
          <span>Cleaning</span>
          <strong>{cleaning}</strong>
          <small>not usable yet</small>
        </article>
        <article>
          <span>Reserved</span>
          <strong>{reserved}</strong>
          <small>held, not open</small>
        </article>
        <article>
          <span>Blocked</span>
          <strong>{blocked}</strong>
          <small>incident on the bed</small>
        </article>
      </div>

      <div className="reports-grid">
        <article>
          <h3>Movement in this log</h3>
          {scopedEvents.length === 0 ? (
            <p className="reports-empty">Insufficient data. The flow log is empty for this filter.</p>
          ) : (
            <ul className="reports-kinds">
              {kindCounts.map((kind) => (
                <li key={kind.id}>
                  <span>{kind.label}</span>
                  <strong>{kind.value}</strong>
                </li>
              ))}
            </ul>
          )}
        </article>
        <article>
          <h3>Open work</h3>
          <p className="reports-empty">{openWork.length} rooms are not usable in this filter.</p>
        </article>
      </div>

      <article className="reports-table">
        <h3>Open work</h3>
        {openWork.length === 0 ? (
          <p className="reports-empty">No cleaning, reserved, or blocked beds in this filter.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Room</th>
                <th>Floor</th>
                <th>State</th>
                <th>Why it is closed</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {openWork.map((room) => (
                <tr key={room.id}>
                  <td>
                    <button type="button" onClick={() => onOpenRoom(room.floorId, room.id)}>{room.id}</button>
                  </td>
                  <td>{room.floorCode}</td>
                  <td>{room.status === "cleaning" ? "Cleaning" : room.status === "reserved" ? "Reserved" : "Blocked"}</td>
                  <td>{closedReason(room, incidentByRoom)}</td>
                  <td>{closedTime(room)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </section>
  );
}

function closedReason(room, incidentByRoom) {
  if (room.status === "cleaning") {
    if (room.linenStage && room.linenStage !== "ready") return "Linen is still out.";
    if (room.housekeeper) return `Assigned to ${room.housekeeper}`;
    return "Waiting for housekeeping";
  }
  if (room.status === "reserved") return room.holdFor ? `Reserved for ${room.holdFor}` : "Reserved";
  return incidentByRoom.get(room.id)?.title || "Out of service";
}

function closedTime(room) {
  if (room.status !== "cleaning" || room.ticksLeft == null || room.ticksLeft <= 0) return "No duration";
  const seconds = room.ticksLeft * 9;
  if (seconds >= 60) return `~${Math.round(seconds / 60)} min left`;
  return `~${seconds}s left`;
}
