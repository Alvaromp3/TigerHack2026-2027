import { useEffect, useState } from "react";
import { NURSE_LOAD } from "./insights";
import { Card, Kpi, PageHead, initialsOf } from "./ui";

const ON_CALL = 4; // backend/app/sim.py CALLBACKS
const TRANSFER_BATCH = 6; // backend/app/sim.py DIVERT_BATCH

function Decision({ id, title, impact, detail, done, doneLabel, confirmLabel, busy, onRun }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(timer);
  }, [armed]);
  return (
    <article className={done ? "decision is-done" : armed ? "decision is-armed" : "decision"}>
      <div>
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      <p className="decision-impact">{impact}</p>
      <button
        type="button"
        disabled={Boolean(busy) || done}
        onClick={async () => {
          if (!armed) {
            setArmed(true);
            return;
          }
          setArmed(false);
          await onRun();
        }}
      >
        {done ? doneLabel : busy === id ? "Working…" : armed ? confirmLabel : title}
      </button>
    </article>
  );
}

export default function StaffTab({ ops, roster, calledPhysicians, divertedCount, edPatients, busy, onCallPhysicians, onDivert }) {
  const staff = ops?.staff?.length ? ops.staff : roster;
  const units = ops?.units || [];
  const keepers = ops?.housekeepers || [];
  const onDuty = staff.filter((person) => person.on_duty);
  const nurses = onDuty.filter((person) => person.role === "nurse");
  const overloaded = nurses.filter((person) => (person.patients || []).length > NURSE_LOAD);
  const freeKeepers = keepers.filter((keeper) => !keeper.room_id);
  const byUnit = new Map();
  for (const person of staff) {
    const key = person.unit || "other";
    if (!byUnit.has(key)) byUnit.set(key, []);
    byUnit.get(key).push(person);
  }
  const unitLabel = Object.fromEntries(units.map((unit) => [unit.id, unit.label]));

  return (
    <div className="page">
      <PageHead
        kicker="Staffing"
        title="Do we have enough hands?"
        sub={`Target is ${NURSE_LOAD} patients per nurse. Bars turn amber near the limit and red above it.`}
      />

      <div className="kpi-row">
        <Kpi icon="users" label="On duty" value={onDuty.length} note={`${nurses.length} nurses · ${onDuty.length - nurses.length} other staff`} />
        <Kpi icon="alert" label="Nurses over target" value={overloaded.length} note={overloaded.length ? "need support" : "everyone within target"} tone={overloaded.length ? "warn" : undefined} />
        <Kpi icon="broom" label="Housekeepers free" value={`${freeKeepers.length}/${keepers.length}`} note="ready to take a clean" />
        <Kpi icon="phone" label="Physicians called in" value={calledPhysicians} note={divertedCount ? `${divertedCount} patients transferred out` : "no transfers out"} />
      </div>

      <section className="decisions">
        <header>
          <p className="card-kicker">Decisions</p>
          <h2>Two levers, one click each</h2>
          <span>Every decision updates the live hospital and is written to the flow log.</span>
        </header>
        <div className="decision-grid">
          <Decision
            id="call"
            title="Call in on-call physicians"
            detail="Brings the on-call roster on duty across Emergency, ICU and Surgery."
            impact={`+${ON_CALL} physicians on the floor`}
            done={calledPhysicians > 0}
            doneLabel={`✓ ${calledPhysicians} called in`}
            confirmLabel={`Confirm · call ${ON_CALL}`}
            busy={busy}
            onRun={onCallPhysicians}
          />
          <Decision
            id="divert"
            title="Transfer ED overflow"
            detail={`Moves up to ${TRANSFER_BATCH} Emergency patients to County General. Their beds go into turnover.`}
            impact={edPatients ? `Frees up to ${Math.min(TRANSFER_BATCH, edPatients)} ED beds` : "Emergency has no patients to transfer"}
            done={false}
            confirmLabel={`Confirm · transfer up to ${Math.min(TRANSFER_BATCH, edPatients)}`}
            busy={busy}
            onRun={onDivert}
          />
        </div>
      </section>

      <div className="unit-grid">
        {units.map((unit) => {
          const ratio = unit.ratio ?? (unit.patients ? Infinity : 0);
          const tone = ratio > NURSE_LOAD ? "is-over" : ratio >= NURSE_LOAD - 0.5 ? "is-near" : "";
          return (
            <article key={unit.id} className={`unit ${tone}`}>
              <span className="card-kicker">{unit.label}</span>
              <div className="unit-ratio">
                <strong>{Number.isFinite(ratio) ? ratio : "—"}</strong>
                <small>patients per nurse</small>
              </div>
              <div className="unit-meter" aria-hidden="true">
                <i style={{ width: `${Math.min(100, (Number.isFinite(ratio) ? ratio : NURSE_LOAD * 1.5) / (NURSE_LOAD * 1.5) * 100)}%` }} />
                <b style={{ left: `${(NURSE_LOAD / (NURSE_LOAD * 1.5)) * 100}%` }} />
              </div>
              <span className="unit-foot">{unit.patients} patients · {unit.nurses} {unit.nurses === 1 ? "nurse" : "nurses"}</span>
            </article>
          );
        })}
      </div>

      <div className="staff-grid">
        {[...byUnit.entries()].map(([unit, people]) => (
          <Card key={unit} icon="users" kicker={unitLabel[unit] || unit.toUpperCase()} title={`${people.filter((person) => person.on_duty).length} on duty`}>
            <ul className="people">
              {people.map((person) => {
                const load = (person.patients || []).length;
                const over = person.role === "nurse" && load > NURSE_LOAD;
                return (
                  <li key={person.id} className={person.on_duty ? "" : "is-off"}>
                    <span className="avatar">{initialsOf(person.name)}</span>
                    <div>
                      <strong>{person.name}</strong>
                      <small>{person.specialty || person.role} · {person.on_duty ? `${person.shift} shift` : "off duty"}</small>
                    </div>
                    {person.on_duty && person.patients && (
                      <span className={over ? "load is-over" : "load"}>{load} pts</span>
                    )}
                    {person.extension && <a className="ext" href={`tel:${person.extension}`}>{person.extension}</a>}
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
        <Card kicker="Environmental services" title="Housekeeping crew" icon="broom">
          <ul className="people">
            {keepers.map((keeper) => (
              <li key={keeper.id}>
                <span className="avatar is-evs">{initialsOf(keeper.name)}</span>
                <div>
                  <strong>{keeper.name}</strong>
                  <small>{keeper.room_id ? `Cleaning ${keeper.room_id}` : "Free"}</small>
                </div>
                <span className={keeper.room_id ? "load" : "load is-free"}>{keeper.room_id ? "busy" : "free"}</span>
              </li>
            ))}
            {keepers.length === 0 && <li className="empty-note">Crew list is loading.</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
}
