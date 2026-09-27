import { cleanEtaSeconds, formatEta, turnoverPlan } from "./insights";
import { Card, Kpi, PageHead, minutesText } from "./ui";

// Where a bed in turnover is right now. Mirrors the housekeeping + linen pipeline in sim.py.
function stageOf(room) {
  const cleanDone = room.ticksLeft === 0;
  const linenDone = !room.linenStage || room.linenStage === "ready";
  if (cleanDone && linenDone) return "ready";
  if (cleanDone) return "linen";
  if (room.housekeeper) return "cleaning";
  return "waiting";
}

const STAGES = [
  { id: "waiting", label: "Waiting for housekeeper", hint: "Assign someone" },
  { id: "cleaning", label: "Cleaning", hint: "Crew on it" },
  { id: "linen", label: "Linen", hint: "Clean sheets on the way" },
  { id: "ready", label: "Ready to open", hint: "One click" },
];

export default function OpsTab({ beds, insights, ops, incidents, busy, onOpenRoom, onAssign, onComplete, onResolve }) {
  const turnover = beds.filter((room) => room.status === "cleaning");
  const reserved = beds.filter((room) => room.status === "reserved");
  const down = beds.filter((room) => room.status === "blocked");
  const freeKeepers = (ops?.housekeepers || []).filter((keeper) => !keeper.room_id);
  const columns = Object.fromEntries(STAGES.map((stage) => [stage.id, []]));
  for (const room of turnover) columns[stageOf(room)].push(room);
  columns.waiting.sort((a, b) => (b.holdFor ? 1 : 0) - (a.holdFor ? 1 : 0) || (b.cleanPriority || 0) - (a.cleanPriority || 0));
  const realIncidents = (incidents || []).filter((item) => typeof item.id !== "string");

  return (
    <div className="page">
      <PageHead
        kicker="Operations"
        title="What keeps beds from reopening?"
        sub="A bed is only useful again once it is cleaned and has fresh linen. Follow every bed through that pipeline."
      />

      <div className="kpi-row">
        <Kpi icon="broom" label="Beds in turnover" value={turnover.length} note={`${columns.waiting.length} waiting for a housekeeper`} tone={columns.waiting.length ? "warn" : undefined} />
        <Kpi
          icon="clock"
          loading={!insights}
          label="Average turnover"
          value={minutesText(insights?.turnover?.avg_minutes)}
          unit="min"
          note="patient leaves → bed ready"
        />
        <Kpi icon="pause" label="Held beds" value={reserved.length} note="reserved for a named patient" />
        <Kpi icon="wrench" label="Out of service" value={down.length} note={realIncidents.length ? `${realIncidents.length} open incidents` : "no open incidents"} />
      </div>

      <section className="pipeline">
        {STAGES.map((stage, index) => (
          <div key={stage.id} className={`lane is-${stage.id}`}>
            <header>
              <span className="lane-step">{index + 1}</span>
              <div>
                <strong>{stage.label}</strong>
                <small>{stage.hint}</small>
              </div>
              <b>{columns[stage.id].length}</b>
            </header>
            <ul>
              {columns[stage.id].map((room, order) => {
                const keeper = stage.id === "waiting" ? freeKeepers[order] : null;
                const plan = turnoverPlan(room);
                return (
                  <li key={room.id}>
                    <button type="button" className="lane-room" onClick={() => onOpenRoom(room.id)}>
                      <strong>{room.id}</strong>
                      <small>{room.floorCode} · {room.deptLabel}</small>
                      {room.holdFor && <em>{room.holdFor} waiting</em>}
                    </button>
                    <div className="lane-progress" aria-hidden="true"><i style={{ width: `${plan.pct}%` }} /></div>
                    {plan.blocker && stage.id !== "ready" && <p className="lane-why">{plan.blocker}</p>}
                    <div className="lane-meta">
                      {stage.id === "cleaning" && <span>{room.housekeeper}</span>}
                      {stage.id === "linen" && <span>{room.linenAide || "Linen"} · {room.linenStage}</span>}
                      {stage.id !== "ready" && <span className="lane-eta">~{formatEta(cleanEtaSeconds(room))}</span>}
                      {stage.id === "waiting" && keeper && (
                        <button type="button" className="dark-btn" disabled={Boolean(busy)} onClick={() => onAssign(room, keeper)}>
                          Send {keeper.name.split(" ")[0]}
                        </button>
                      )}
                      {stage.id === "ready" && (
                        <button type="button" className="dark-btn" disabled={Boolean(busy)} onClick={() => onComplete(room)}>
                          Open bed
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
              {columns[stage.id].length === 0 && (
                <li className="lane-empty">
                  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 10.5 3.2 3L15 6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  Clear
                </li>
              )}
            </ul>
          </div>
        ))}
      </section>

      <div className="flow-grid is-two">
        <Card kicker="Out of service" title="Maintenance and incidents" icon="wrench">
          <ul className="stay-list">
            {down.map((room) => {
              const incident = realIncidents.find((item) => item.room_id === room.id);
              return (
                <li key={room.id}>
                  <button type="button" onClick={() => onOpenRoom(room.id)}>
                    <span className="stay-room">{room.id}</span>
                    <span className="stay-who">
                      <strong>{incident?.title || "Out of service"}</strong>
                      <small>{room.floorCode} · {room.deptLabel}{incident?.severity ? ` · ${incident.severity}` : ""}</small>
                    </span>
                  </button>
                  {incident && (
                    <button type="button" className="dark-btn" disabled={Boolean(busy)} onClick={() => onResolve(incident)}>
                      Resolve
                    </button>
                  )}
                </li>
              );
            })}
            {down.length === 0 && <li className="empty-note">Every bed is in service.</li>}
          </ul>
        </Card>
        <Card kicker="Reserved" title="Beds held for a patient" icon="pause">
          <ul className="stay-list">
            {reserved.map((room) => (
              <li key={room.id}>
                <button type="button" onClick={() => onOpenRoom(room.id)}>
                  <span className="stay-room">{room.id}</span>
                  <span className="stay-who">
                    <strong>{room.holdFor || "Hold"}</strong>
                    <small>{room.floorCode} · {room.deptLabel}</small>
                  </span>
                </button>
              </li>
            ))}
            {reserved.length === 0 && <li className="empty-note">No beds on hold.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
