import { Fragment, useEffect, useRef, useState } from "react";
import { apiUrl } from "../api/client";

const PROMPTS = [
  "Where do I put a critical trauma patient?",
  "What is blocking beds right now?",
  "Who can clean a room?",
];

const ROOM_TOKEN = /\b[A-Z]{2,5}-[A-Z0-9]{1,3}\b/g;

// **bold** only; the assistant is told to keep formatting light.
function inline(text) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**")
      ? <b key={index}>{part.slice(2, -2)}</b>
      : <Fragment key={index}>{part}</Fragment>,
  );
}

function Reply({ text }) {
  const blocks = [];
  let list = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) {
      list = null;
      continue;
    }
    const bullet = line.match(/^([-*•]|\d+\.)\s+(.*)$/);
    if (bullet) {
      if (!list) {
        list = [];
        blocks.push({ list });
      }
      list.push(bullet[2]);
    } else {
      list = null;
      blocks.push({ line });
    }
  }
  return blocks.map((block, index) =>
    block.list ? (
      <ul key={index}>{block.list.map((item, row) => <li key={row}>{inline(item)}</li>)}</ul>
    ) : (
      <span key={index} className="assist-line">{inline(block.line)}</span>
    ),
  );
}

export default function ChatPanel({ open, onClose, surgeOn = false, roomIds, onOpenRoom, autoAsk }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const logRef = useRef(null);
  const asked = useRef(null);

  useEffect(() => {
    if (!open) return;
    let stop = false;
    fetch(apiUrl("/api/chat/status"))
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!stop && body) setOffline(!body.configured);
      })
      .catch(() => {});
    return () => {
      stop = true;
    };
  }, [open]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy, error]);

  useEffect(() => {
    if (!open || !autoAsk || asked.current === autoAsk.id) return;
    asked.current = autoAsk.id;
    ask(autoAsk.text);
    // ask reads the latest messages; autoAsk.id is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoAsk]);

  async function ask(text) {
    const question = text.trim();
    if (!question || busy) return;
    const next = [...messages, { role: "user", content: question }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    setError("");
    try {
      const res = await fetch(apiUrl("/api/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-12) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.detail === "string" ? body.detail : "The assistant could not answer.");
        return;
      }
      setMessages([...next, { role: "assistant", content: body.reply }]);
    } catch {
      setError("The assistant could not be reached. The server may be waking up; try again in a few seconds.");
    } finally {
      setBusy(false);
    }
  }

  function roomsIn(text) {
    const found = [...new Set(text.match(ROOM_TOKEN) || [])];
    return roomIds ? found.filter((id) => roomIds.has(id)) : found;
  }

  if (!open) return null;

  return (
    <div className="assist-pop" role="dialog" aria-label="Operations assistant" data-demo="chat">
      <header>
        <span className="assist-mark" aria-hidden="true">
          <svg viewBox="0 0 20 20" fill="none">
            <path d="M10 2.5 11.8 8.2 17.5 10l-5.7 1.8L10 17.5l-1.8-5.7L2.5 10l5.7-1.8L10 2.5Z" fill="currentColor" />
          </svg>
        </span>
        <div className="assist-title">
          <strong>Ops assistant</strong>
          <small>{offline ? "Offline · API key missing on server" : "Reads the live census · Gemini"}</small>
        </div>
        <button type="button" onClick={onClose} aria-label="Close assistant">×</button>
      </header>
      <div className="assist-log" ref={logRef}>
        {messages.length === 0 && (
          <div className="assist-intro">
            <strong>Ask the hospital.</strong>
            <span>Answers come from the live census. Every bed it names becomes a button to the map.</span>
          </div>
        )}
        {messages.map((message, index) => {
          if (message.role === "user") {
            return <p key={index} className="is-user">{message.content}</p>;
          }
          const rooms = roomsIn(message.content);
          return (
            <div key={index} className="is-assistant">
              <Reply text={message.content} />
              {rooms.length > 0 && onOpenRoom && (
                <div className="assist-rooms">
                  {rooms.slice(0, 4).map((id) => (
                    <button key={id} type="button" onClick={() => onOpenRoom(id)}>
                      Go to {id}
                      <svg viewBox="0 0 12 12" aria-hidden="true">
                        <path d="m4.5 2.5 3.5 3.5-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {busy && (
          <p className="is-assistant is-typing" aria-label="Thinking">
            <i /><i /><i />
          </p>
        )}
        {error && <p className="is-error">{error}</p>}
      </div>
      <div className="assist-prompts">
        {(surgeOn ? ["What is coming in?", ...PROMPTS] : PROMPTS).map((prompt) => (
          <button key={prompt} type="button" onClick={() => ask(prompt)} disabled={busy}>
            {prompt}
          </button>
        ))}
      </div>
      <form onSubmit={(event) => {
        event.preventDefault();
        ask(draft);
      }}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask about beds, patients, or staff"
          aria-label="Message"
        />
        <button type="submit" disabled={busy || !draft.trim()}>Send</button>
      </form>
    </div>
  );
}
