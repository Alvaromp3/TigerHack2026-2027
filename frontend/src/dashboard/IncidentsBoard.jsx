import { useMemo, useState } from "react";

export default function IncidentsBoard({ hospital, incidents, onReport, onResolve, onOpenRoom, notice }) {
  const rooms = useMemo(
    () => hospital.flatMap((floor) => floor.rooms.filter((room) => room.census).map((room) => ({
      id: room.id,
      floor: floor.code,
    }))),
    [hospital],
  );
  const [roomId, setRoomId] = useState(rooms[0]?.id || "");
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("high");
  const open = incidents.filter((item) => item.status === "open");
  const closed = incidents.filter((item) => item.status !== "open").slice(0, 8);

  return (
    <section className="reports-page" aria-label="Incidents">
      <header className="reports-head">
        <div>
          <p className="kicker">Out of service</p>
          <h2>Incidents</h2>
          <p>An open incident blocks that bed on the map and in capacity until it is resolved.</p>
        </div>
      </header>
      {notice && <p className="command-note">{notice}</p>}

      <div className="reports-grid">
        <article>
          <h3>Report</h3>
          <form
            className="incident-form"
            onSubmit={(event) => {
              event.preventDefault();
              const nextTitle = title.trim();
              if (!roomId || !nextTitle) return;
              onReport({ room_id: roomId, title: nextTitle, severity });
              setTitle("");
            }}
          >
            <label>
              <span>Room</span>
              <select value={roomId} onChange={(event) => setRoomId(event.target.value)} aria-label="Room">
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>{room.floor} · {room.id}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Issue</span>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="What is stopping this room"
              />
            </label>
            <label>
              <span>Severity</span>
              <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="critical">Critical</option>
              </select>
            </label>
            <button type="submit">Report incident</button>
          </form>
        </article>
        <article>
          <h3>Open · {open.length}</h3>
          {open.length === 0 ? (
            <p className="reports-empty">No bed is held for an incident.</p>
          ) : (
            <ul className="incident-list">
              {open.map((item) => (
                <li key={item.id} className="incident-row">
                  <div className="incident-row-body">
                    <div className="incident-row-head">
                      <button type="button" onClick={() => onOpenRoom(item.room_id)}>{item.room_id}</button>
                      <span className={`severity severity-${item.severity}`}>{item.severity}</span>
                    </div>
                    <p>{item.title}</p>
                    <div className="incident-row-meta">
                      <small>{clock(item.created_at)}</small>
                      <button type="button" onClick={() => onResolve(item.id)}>Resolve</button>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <h3>Closed</h3>
          {closed.length === 0 ? (
            <p className="reports-empty">No recent closures.</p>
          ) : (
            <ul className="incident-list compact">
              {closed.map((item) => (
                <li key={item.id} className="incident-row resolved">
                  <div className="incident-row-body">
                    <div className="incident-row-head">
                      <strong>{item.room_id}</strong>
                      <span className="severity resolved-tag">Resolved</span>
                    </div>
                    <p>{item.title}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </article>
      </div>
    </section>
  );
}

function clock(iso) {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}
