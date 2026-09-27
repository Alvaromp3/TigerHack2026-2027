// Right-hand rail on the live map when no room is open: bed forecast + ranked actions.
export default function CommandRail({ outlook, actions, busy, surgeOn, onRun, onOpenRoom }) {
  const delta = outlook.soon - outlook.now;
  return (
    <div className="rail">
      <header className="rail-head">
        <p className="kicker">Command</p>
        <h2>{surgeOn ? "Surge plan" : "Next best actions"}</h2>
      </header>

      <section className="forecast" data-demo="forecast">
        <div className="forecast-top">
          <span>Open beds</span>
          <em>Projected · next {outlook.horizon} min</em>
        </div>
        <div className="forecast-nums">
          <div>
            <strong>{outlook.now}</strong>
            <small>now</small>
          </div>
          <svg viewBox="0 0 40 12" aria-hidden="true">
            <path d="M1 6h34M30 1.5 36 6l-6 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className={delta > 0 ? "is-up" : ""}>
            <strong>{outlook.soon}</strong>
            <small>{delta > 0 ? `+${delta} coming` : "no change"}</small>
          </div>
        </div>
        <ul className="forecast-why">
          <li><i className="is-clean" />{outlook.cleans} cleans finishing</li>
          <li><i className="is-occ" />{outlook.discharges} likely discharges</li>
        </ul>
      </section>

      {actions.length === 0 ? (
        <div className="rail-empty">
          <strong>Nothing is blocking flow.</strong>
          <span>New actions appear here the moment a bed, a clean, or a nurse needs attention.</span>
        </div>
      ) : (
        <ol className="actions" data-demo="actions">
          {actions.map((item, index) => (
            <li key={item.id} className={`action is-${item.tone}`}>
              <span className="action-rank">{index + 1}</span>
              <div className="action-body">
                <strong>{item.title}</strong>
                <span>{item.detail}</span>
                <div className="action-foot">
                  <em>{item.gain}</em>
                  <div className="action-btns">
                    {item.roomId && (
                      <button type="button" className="action-view" onClick={() => onOpenRoom(item.roomId)}>
                        View
                      </button>
                    )}
                    {item.run && (
                      <button
                        type="button"
                        className="action-go"
                        disabled={Boolean(busy)}
                        onClick={() => onRun(item)}
                      >
                        {busy === item.id ? "Working…" : item.run.label}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
