import { useState } from "react";
import { apiUrl } from "../api/client";

export default function ChatPanel({ open, onClose }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    const next = [...messages, { role: "user", content: text }];
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
        setError(body.detail || "The assistant could not answer.");
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
      <form onSubmit={send}>
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
