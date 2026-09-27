import { Fragment, useEffect, useRef, useState } from "react";
import { API_BASE, actorHeaders, apiUrl, getJson } from "../api/client";
import { clockTime } from "./network/ems";
import { Card, PageHead } from "./ui";

const ENDPOINTS = [
  { label: "Regional availability", path: "/api/public/availability", note: "Every hospital, every unit" },
  { label: "Route a stroke patient", path: "/api/public/route?esi=2&complaint=stroke&zone=East", note: "Ranked with reasons" },
  { label: "Ambulances on the road", path: "/api/public/traffic", note: "Positions only" },
  { label: "Open beds (FHIR)", path: "/fhir/Location?operational-status=U&_count=5", note: "HL7 table 0116" },
  { label: "Current encounters (FHIR)", path: "/fhir/Encounter?status=in-progress&_count=3", note: "Synthetic patients" },
  { label: "Capability statement", path: "/fhir/metadata", note: "FHIR R4 4.0.1" },
];

const WEBHOOK_TYPES = ["ems.*", "hospital.*", "bed.available", "patient.admitted", "patient.discharged"];

// Tiny JSON highlighter: keys, strings, numbers, literals.
function JsonView({ value }) {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  const parts = text.split(/("(?:\\.|[^"\\])*"(?:\s*:)?|\b-?\d+(?:\.\d+)?\b|\btrue\b|\bfalse\b|\bnull\b)/g);
  return (
    <pre className="code-view">
      {parts.map((part, index) => {
        let kind = "";
        if (/^".*":$/.test(part.replace(/\s/g, ""))) kind = "k";
        else if (part.startsWith('"')) kind = "s";
        else if (/^-?\d/.test(part)) kind = "n";
        else if (/^(true|false|null)$/.test(part)) kind = "l";
        return kind ? <span key={index} className={`tok-${kind}`}>{part}</span> : <Fragment key={index}>{part}</Fragment>;
      })}
    </pre>
  );
}

function Hl7View({ value }) {
  return (
    <pre className="code-view is-hl7">
      {String(value).split(/\r|\n/).map((segment, index) => (
        <div key={index}>
          <span className="tok-k">{segment.slice(0, 3)}</span>
          {segment.slice(3).split("|").map((field, i) => (
            <Fragment key={i}>{i ? <span className="tok-p">|</span> : null}{field}</Fragment>
          ))}
        </div>
      ))}
    </pre>
  );
}

function copy(text) {
  navigator.clipboard?.writeText(text).catch(() => {});
}

function ApiExplorer() {
  const [picked, setPicked] = useState(ENDPOINTS[0]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let stop = false;
    setLoading(true);
    const started = performance.now();
    fetch(apiUrl(picked.path), { headers: { Accept: "application/json, application/fhir+json" } })
      .then(async (res) => {
        const body = await res.text();
        if (stop) return;
        let parsed = body;
        try {
          parsed = JSON.parse(body);
        } catch {
          // show raw text
        }
        setResult({
          status: res.status,
          ms: Math.round(performance.now() - started),
          size: body.length,
          type: res.headers.get("content-type") || "",
          body: parsed,
        });
      })
      .catch(() => !stop && setResult({ status: "offline", ms: 0, size: 0, type: "", body: "The API did not answer." }))
      .finally(() => !stop && setLoading(false));
    return () => {
      stop = true;
    };
  }, [picked]);

  const curl = `curl -s "${API_BASE}${picked.path}"`;
  return (
    <Card kicker="Open API" title="The public availability database" icon="bars" className="od-api">
      <div className="od-api-grid">
        <ul className="od-endpoints">
          {ENDPOINTS.map((item) => (
            <li key={item.path}>
              <button type="button" className={picked.path === item.path ? "is-on" : ""} onClick={() => setPicked(item)}>
                <span className="od-verb">GET</span>
                <span className="od-ep">
                  <strong>{item.label}</strong>
                  <small>{item.path}</small>
                </span>
              </button>
            </li>
          ))}
          <li className="od-links">
            <a href={apiUrl("/docs")} target="_blank" rel="noreferrer">Interactive API docs ↗</a>
            <a href="/public.html" target="_blank" rel="noreferrer">Public board ↗</a>
          </li>
        </ul>
        <div className="od-response">
          <div className="od-meta">
            <span className={result && result.status === 200 ? "od-status is-ok" : "od-status"}>{loading ? "…" : result?.status}</span>
            <span>{result ? `${result.ms} ms · ${(result.size / 1024).toFixed(1)} KB · ${result.type.split(";")[0]}` : ""}</span>
            <button type="button" className="ghost-btn" onClick={() => copy(curl)}>Copy curl</button>
          </div>
          <code className="od-curl">{curl}</code>
          {result && <JsonView value={result.body} />}
        </div>
      </div>
    </Card>
  );
}

function Webhooks() {
  const [subs, setSubs] = useState([]);
  const [inbox, setInbox] = useState([]);
  const [url, setUrl] = useState(apiUrl("/api/platform/sandbox/inbox"));
  const [types, setTypes] = useState(["ems.*", "hospital.*"]);
  const [secret, setSecret] = useState("");
  const [note, setNote] = useState("");

  async function refresh() {
    try {
      const [list, box] = await Promise.all([getJson("/api/platform/webhooks"), getJson("/api/platform/sandbox/inbox?limit=8")]);
      setSubs(list.subscriptions);
      setInbox(box.messages);
    } catch {
      // keep the last view
    }
  }

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 3000);
    return () => clearInterval(timer);
  }, []);

  async function call(path, method, body) {
    setNote("");
    try {
      const data = await getJson(path, {
        method,
        headers: { "Content-Type": "application/json", ...actorHeaders() },
        body: body ? JSON.stringify(body) : undefined,
      });
      await refresh();
      return data;
    } catch (error) {
      setNote(error.message);
      return null;
    }
  }

  return (
    <Card kicker="Webhooks" title="Push alerts to ambulance companies" icon="transfer" className="od-hooks">
      <form
        className="od-hook-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const created = await call("/api/platform/webhooks", "POST", { url, event_types: types, description: "Ambulance dispatch" });
          if (created) setSecret(created.secret);
        }}
      >
        <input value={url} onChange={(event) => setUrl(event.target.value)} aria-label="Endpoint URL" />
        <div className="chip-pick">
          {WEBHOOK_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              className={types.includes(type) ? "is-on" : ""}
              onClick={() => setTypes((current) => (current.includes(type) ? current.filter((item) => item !== type) : [...current, type]))}
            >
              {type}
            </button>
          ))}
        </div>
        <button type="submit" className="dark-btn">Subscribe</button>
      </form>
      {secret && (
        <p className="od-secret">
          Signing secret, shown once: <code>{secret}</code>
          <button type="button" className="ghost-btn" onClick={() => copy(secret)}>Copy</button>
        </p>
      )}
      {note && <p className="od-note">{note}</p>}
      <ul className="od-subs">
        {subs.map((sub) => (
          <li key={sub.id} className={sub.active ? "" : "is-paused"}>
            <div>
              <strong>{sub.url}</strong>
              <small>
                {sub.event_types.length ? sub.event_types.join(", ") : "all events"} · {sub.delivered_24h} delivered · {sub.failed_24h} failed
                {sub.last_delivery ? ` · last HTTP ${sub.last_delivery.status_code ?? "error"}` : ""}
              </small>
            </div>
            <button type="button" className="ghost-btn" onClick={() => call(`/api/platform/webhooks/${sub.id}/test`, "POST")}>Test</button>
            <button type="button" className="ghost-btn" onClick={() => call(`/api/platform/webhooks/${sub.id}`, "PATCH", { active: !sub.active })}>
              {sub.active ? "Pause" : "Resume"}
            </button>
            <button type="button" className="ghost-btn" onClick={() => call(`/api/platform/webhooks/${sub.id}`, "DELETE")}>Delete</button>
          </li>
        ))}
        {!subs.length && <li className="empty-note">No subscriptions yet. Subscribe the built-in sandbox to watch signed deliveries arrive.</li>}
      </ul>
      <p className="card-kicker od-inbox-title">Sandbox receiver</p>
      <ul className="od-inbox">
        {inbox.map((message) => (
          <li key={message.id}>
            <span className={message.signature_valid ? "od-sig is-ok" : "od-sig"}>{message.signature_valid ? "✓ Signature verified" : "✕ Bad signature"}</span>
            <strong>{message.event_type.replace("org.tigermemorial.", "")}</strong>
            <small>{clockTime(message.received_at)}</small>
          </li>
        ))}
        {!inbox.length && <li className="empty-note">Nothing received yet.</li>}
      </ul>
    </Card>
  );
}

function EventStream() {
  const [events, setEvents] = useState([]);
  const [detail, setDetail] = useState(null);
  const [view, setView] = useState("cloudevent");
  const cursor = useRef(null);

  useEffect(() => {
    let stop = false;
    async function pull() {
      try {
        const path = cursor.current == null ? "/api/platform/events?limit=40" : `/api/platform/events?after=${cursor.current}&limit=60`;
        const body = await getJson(path);
        if (stop) return;
        cursor.current = body.cursor ?? cursor.current;
        if (body.events.length) setEvents((current) => [...body.events.reverse(), ...current].slice(0, 80));
      } catch {
        // retry on the next tick
      }
    }
    pull();
    const timer = setInterval(pull, 2000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  async function open(row) {
    try {
      setDetail(await getJson(`/api/platform/events/${row.id}`));
      setView("cloudevent");
    } catch {
      setDetail(null);
    }
  }

  return (
    <Card kicker="Event stream" title="Everything that happens, as it happens" icon="trend" className="od-stream">
      <div className="od-stream-grid">
        <ul className="od-events">
          {events.map((row) => (
            <li key={row.id}>
              <button type="button" className={detail?.event.id === row.id ? "is-on" : ""} onClick={() => open(row)}>
                <i style={{ background: row.color }} />
                <span className="od-type">{row.type}</span>
                <span className="od-msg">{row.message}</span>
                <small>{clockTime(row.time)}</small>
              </button>
            </li>
          ))}
          {!events.length && <li className="empty-note">Waiting for the first event…</li>}
        </ul>
        <div className="od-detail">
          {detail ? (
            <>
              <div className="od-tabs">
                {["cloudevent", "hl7", "fhir"].map((name) => (
                  <button
                    key={name}
                    type="button"
                    className={view === name ? "is-on" : ""}
                    disabled={name !== "cloudevent" && !detail[name]}
                    onClick={() => setView(name)}
                  >
                    {name === "cloudevent" ? "CloudEvent" : name === "hl7" ? "HL7 v2" : "FHIR R4"}
                  </button>
                ))}
              </div>
              {view === "hl7" && detail.hl7 ? <Hl7View value={detail.hl7} /> : <JsonView value={view === "fhir" ? detail.fhir : detail.cloudevent} />}
            </>
          ) : (
            <p className="empty-note">Pick an event to see it as a CloudEvent, an HL7 v2 message and a FHIR resource.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function AuditLog() {
  const [entries, setEntries] = useState([]);
  useEffect(() => {
    let stop = false;
    async function pull() {
      try {
        const body = await getJson("/api/platform/audit?limit=60");
        if (!stop) setEntries(body.entries);
      } catch {
        // keep the last view
      }
    }
    pull();
    const timer = setInterval(pull, 5000);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, []);

  function exportCsv() {
    const rows = [["time", "actor", "action", "target", "detail"], ...entries.map((row) => [row.created_at, row.actor, row.action, row.target || "", row.detail || ""])];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.download = "surgecommand-audit.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <Card
      kicker="Audit trail"
      title="Who decided what, and when"
      icon="list"
      className="od-audit"
      action={<button type="button" className="link-btn" onClick={exportCsv}>Export CSV</button>}
    >
      <table className="amb-table">
        <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead>
        <tbody>
          {entries.map((row) => (
            <tr key={row.id}>
              <td>{clockTime(row.created_at)}</td>
              <td>{row.actor}</td>
              <td className="mono">{row.action}</td>
              <td className="mono">{row.target || "—"}</td>
              <td>{row.detail || "—"}</td>
            </tr>
          ))}
          {!entries.length && <tr><td colSpan={5} className="empty-note">No decisions recorded yet.</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

export default function OpenDataTab() {
  return (
    <div className="page">
      <PageHead
        kicker="Open data"
        title="Any ambulance company can plug in."
        sub="A public availability API with no patient data, FHIR R4 for hospital systems, signed webhooks for alerts, and a full audit trail."
      />
      <ApiExplorer />
      <div className="od-two">
        <Webhooks />
        <AuditLog />
      </div>
      <EventStream />
    </div>
  );
}
