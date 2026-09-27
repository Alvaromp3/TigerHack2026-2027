// Presenter card for the guided demo. The steps and their actions live in CommandCenter.
export default function DemoTour({ steps, index, busy, onAction, onBack, onExit }) {
  const step = steps[index];
  const last = index === steps.length - 1;
  return (
    <aside className="tour" role="dialog" aria-label="Guided demo">
      <div className="tour-top">
        <span className="tour-live"><i />Live demo</span>
        <span className="tour-count">{index + 1} / {steps.length}</span>
        <button type="button" className="tour-x" onClick={onExit} aria-label="Exit demo">×</button>
      </div>
      <div className="tour-dots" aria-hidden="true">
        {steps.map((item, dot) => (
          <i key={item.title} className={dot < index ? "is-done" : dot === index ? "is-on" : ""} />
        ))}
      </div>
      <h3>{step.title}</h3>
      <p className="tour-say">{step.say}</p>
      <div className="tour-actions">
        {index > 0 && (
          <button type="button" className="tour-back" onClick={onBack} disabled={Boolean(busy)}>
            Back
          </button>
        )}
        <button type="button" className="tour-go" onClick={onAction} disabled={Boolean(busy)}>
          <span>{busy ? "Working…" : step.cta}</span>
          <span className="pill-knob" aria-hidden="true">
            <svg viewBox="0 0 18 18" fill="none">
              <path d={last ? "m4 9.5 3.5 3.5L14 5.5" : "m6.6 3.6 6 5.4-6 5.4"} stroke="#fff" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </button>
      </div>
    </aside>
  );
}
