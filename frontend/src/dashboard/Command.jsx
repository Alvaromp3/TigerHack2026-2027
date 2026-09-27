import { useState } from "react";

const FILTERS = [
  { id: "all", label: "Needs attention" },
  { id: "usable", label: "Usable" },
  { id: "transfers", label: "Transfers" },
  { id: "cleans", label: "Cleans" },
  { id: "incidents", label: "Incidents" },
];

function ageLabel(seconds) {
  if (seconds == null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function countFor(counts, id) {
  if (id === "usable") return counts.usable;
  if (id === "transfers") return counts.transfers;
  if (id === "cleans") return counts.cleans;
  return counts.incidents;
}

function rowsFor(ops, filter) {
  if (!ops) return [];
  if (filter === "usable") {
    return (ops.usable || []).map((room) => ({
      id: `usable:${room.room_id}`,
      kind: "usable",
      room_id: room.room_id,
      floor_id: room.floor_id,
      title: "Usable bed",
      reason: room.dept,
      age_seconds: null,
      nav: "live",
    }));
  }
  const items = ops.items || [];
  if (filter === "all") return items;
  if (filter === "transfers") return items.filter((item) => item.kind === "transfer");
  if (filter === "cleans") return items.filter((item) => item.kind === "clean");
  return items.filter((item) => item.kind === "incident");
}

export default function Command({
  ops,
  surgeOn,
  incomingNotice,
  calledPhysicians,
  divertedCount,
  onDeclareIncoming,
  onCallPhysicians,
  onDivert,
  onResetDemo,
  onOpenItem,
  onAssign,
  onComplete,
  keepers,
  notice,
}) {
  const counts = ops?.counts || { usable: 0, transfers: 0, cleans: 0, incidents: 0 };
  const [filter, setFilter] = useState("all");
  const [draft, setDraft] = useState("");
  const items = rowsFor(ops, filter);
  const freeKeepers = (keepers || []).filter((keeper) => !keeper.room_id);

  return (
    <section className="reports-page command-page" aria-label="Command">
      <header className="reports-head">
        <div>
          <p className="kicker">Operations</p>
          <h2>Command</h2>
          <p>What is stopped, and what is still usable. Same census as the map.</p>
        </div>
        <div className="reports-tools">
          <button type="button" className="is-quiet" onClick={onResetDemo}>Reset demo</button>
        </div>
      </header>

      <form
        className="incoming-bar"
        onSubmit={(event) => {
          event.preventDefault();
          const text = draft.trim();
          if (!text || surgeOn) return;
          onDeclareIncoming(text);
          setDraft("");
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={240}
          placeholder="What is coming in?"
          aria-label="Incoming event"
          disabled={Boolean(incomingNotice)}
        />
        <button type="submit" disabled={Boolean(incomingNotice) || !draft.trim()}>Declare incoming</button>
        {incomingNotice && (
          <>
            <button type="button" onClick={onCallPhysicians} disabled={calledPhysicians > 0}>
              {calledPhysicians > 0 ? `${calledPhysicians} physicians called` : "Call in physicians"}
            </button>
            <button type="button" onClick={onDivert}>Divert to another hospital</button>
          </>
        )}
      </form>

      {surgeOn && incomingNotice && (
        <p className="incoming-banner">{incomingNotice}</p>
      )}
      {surgeOn && divertedCount > 0 && (
        <p className="command-note">{divertedCount} patients diverted to County General.</p>
      )}

      {notice && <p className="command-note">{notice}</p>}

      <div className="reports-metrics" aria-label="Hospital pressure">
        {FILTERS.filter((item) => item.id !== "all").map((item) => (
          <button
            key={item.id}
            type="button"
            className={filter === item.id ? "command-metric is-on" : "command-metric"}
            onClick={() => setFilter(filter === item.id ? "all" : item.id)}
          >
            <span>{item.label}</span>
            <strong>{countFor(counts, item.id)}</strong>
            <small>{item.id === "usable" ? "open census beds" : "in the queue"}</small>
          </button>
        ))}
      </div>

      <div className="command-filters" role="tablist" aria-label="Queue filter">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={filter === item.id}
            className={filter === item.id ? "space-chip is-on" : "space-chip"}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <article className="reports-table">
        <h3>{filter === "usable" ? "Usable beds" : "Attention queue"}</h3>
        {items.length === 0 ? (
          <p className="reports-empty">Nothing in this list.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Where</th>
                <th>What</th>
                <th>Why</th>
                <th>Age</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>
                    <button type="button" onClick={() => onOpenItem(item)}>
                      {item.room_id || item.floor_id || "Hospital"}
                    </button>
                  </td>
                  <td>{item.title}</td>
                  <td>{item.reason}</td>
                  <td>{ageLabel(item.age_seconds)}</td>
                  <td className="command-actions">
                    {item.kind === "clean" && freeKeepers.length > 0 && (
                      <select
                        aria-label={`Assign ${item.room_id}`}
                        defaultValue=""
                        onChange={(event) => {
                          const id = Number(event.target.value);
                          event.target.value = "";
                          if (id) onAssign(item.room_id, id);
                        }}
                      >
                        <option value="">Assign</option>
                        {freeKeepers.map((keeper) => (
                          <option key={keeper.id} value={keeper.id}>{keeper.name}</option>
                        ))}
                      </select>
                    )}
                    {item.kind === "clean" && (
                      <button type="button" onClick={() => onComplete(item.room_id)}>Complete</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </article>
    </section>
  );
}
