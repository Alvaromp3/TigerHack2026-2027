import { useState } from "react";
import { apiUrl } from "../api/client";

const PROMPTS = [
  "What is stopped?",
  "Who can clean a room?",
  "Which bed can I use?",
];

export default function ChatPanel({ open, onClose, surgeOn = false }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function ask(text) {
    const question = text.trim();
    if (!question || busy) return;
    const next = [...messages, { role: "user", content: question }];
    setMessages(next);
    setDraft("");
    setBusy(true);
    setError("");
    try {
      const res = await fetch(import.meta.env.DEV ? "/api/chat" : apiUrl("/api/chat"), {
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
      setError("The assistant could not be reached.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div className="assist-pop" role="dialog" aria-label="President assistant">
      <header>
        <strong>President</strong>
        <button type="button" onClick={onClose} aria-label="Close assistant">×</button>
      </header>
      <div className="assist-log">
        {messages.length === 0 && (
          <p>Ask what is stopped, which unit is full, or who can take a clean. Answers use the live census only.</p>
        )}
        {messages.map((message, index) => (
          <p key={`${message.role}-${index}`} className={message.role === "user" ? "is-user" : "is-assistant"}>
            {message.content}
          </p>
        ))}
        {busy && <p className="is-assistant">Reading the census…</p>}
        {error && <p className="is-error">{error}</p>}
      </div>
      <div className="assist-prompts">
        {(surgeOn ? [...PROMPTS, "What is coming in?"] : PROMPTS).map((prompt) => (
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
          placeholder="Ask about the hospital"
          aria-label="Message"
        />
        <button type="submit" disabled={busy || !draft.trim()}>Send</button>
      </form>
    </div>
  );
}
