function unitLabel(unit) {
  if (unit === "ed") return "Emergency";
  if (unit === "icu") return "Intensive Care";
  if (unit === "med") return "Medical";
  if (unit === "surg") return "Surgery";
  return unit;
}

export default function StaffBoard({ ops, onAssign, notice }) {
  const people = ops?.staff || [];
  const keepers = ops?.housekeepers || [];
  const cleans = (ops?.items || []).filter((item) => item.kind === "clean");
  const freeKeepers = keepers.filter((keeper) => !keeper.room_id);
  const units = ops?.units || [];

  return (
    <section className="reports-page" aria-label="Staff">
      <header className="reports-head">
        <div>
          <p className="kicker">Coverage</p>
          <h2>Staff</h2>
          <p>Who is on, how many patients they already have, and who can take a clean.</p>
        </div>
      </header>
      {notice && <p className="command-note">{notice}</p>}

      <div className="reports-metrics">
        {units.map((unit) => (
          <article key={unit.id}>
            <span>{unit.label}</span>
            <strong>{unit.nurses}</strong>
            <small>{unit.patients} patients · {unit.ratio == null ? "—" : unit.ratio} per nurse</small>
          </article>
        ))}
      </div>

      <div className="reports-grid">
        <article>
          <h3>Roster</h3>
          <table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th>Unit</th>
                <th>Duty</th>
                <th>Patients</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.id}>
                  <td>{person.name}</td>
                  <td>{person.role}</td>
                  <td>{unitLabel(person.unit)}</td>
                  <td>{person.on_duty ? `${person.shift} shift` : "Off duty"}</td>
                  <td>{person.patients?.length ? person.patients.join(", ") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
        <article>
          <h3>Housekeeping</h3>
          {cleans.length === 0 ? (
            <p className="reports-empty">Every open clean already has a person.</p>
          ) : (
            <ul className="staff-cleans">
              {cleans.map((item) => (
                <li key={item.id}>
                  <strong>{item.room_id}</strong>
                  <span>{item.reason}</span>
                  {freeKeepers.length === 0 ? (
                    <em>No one free</em>
                  ) : (
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
                </li>
              ))}
            </ul>
          )}
          <h3>On a room</h3>
          <ul className="staff-cleans">
            {keepers.filter((keeper) => keeper.room_id).map((keeper) => (
              <li key={keeper.id}>
                <strong>{keeper.name}</strong>
                <span>{keeper.room_id}</span>
              </li>
            ))}
            {keepers.every((keeper) => !keeper.room_id) && <li><span>No housekeeper is on a room.</span></li>}
          </ul>
        </article>
      </div>
    </section>
  );
}
