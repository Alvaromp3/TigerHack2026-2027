import { readFileSync } from "node:fs";

const SYSTEM = `You are the operations assistant for the president of Tiger Memorial Hospital.
Answer only from the operations snapshot in this prompt.
If the snapshot does not contain the fact, say it is not in the census.
Do not invent patients, staff, beds, times, or vital signs.
If a vital sign is missing, say it is not recorded.
Point to the live map for the room. Do not mention other screens.
Reply in the same language as the latest user message.
Keep the answer short enough to read on one screen.`;

function readEnvFile(path) {
  const values = {};
  let text = "";
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return values;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match || match[1].startsWith("#")) continue;
    values[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
  }
  return values;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function googleChat({ api, envFile }) {
  return {
    name: "google-chat",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split("?")[0];
        if (req.method !== "POST" || path !== "/api/chat") {
          next();
          return;
        }
        try {
          const reply = await answer(await readBody(req), api, envFile);
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ reply }));
        } catch (error) {
          res.statusCode = error.status || 502;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ detail: error.message || "The assistant could not answer." }));
        }
      });
    },
  };
}

async function answer(raw, api, envFile) {
  const env = readEnvFile(envFile);
  const key = env.GOOGLE_API_KEY || "";
  const model = env.GOOGLE_MODEL || "gemini-2.5-flash";
  if (!key) throw fail(503, "The assistant is not configured.");

  let body;
  try {
    body = JSON.parse(raw || "{}");
  } catch {
    throw fail(422, "Send a question.");
  }
  const turns = (body.messages || [])
    .slice(-12)
    .filter((turn) => (turn.role === "user" || turn.role === "assistant") && String(turn.content || "").trim())
    .map((turn) => ({ role: turn.role, content: String(turn.content).trim() }));
  if (!turns.length || turns[turns.length - 1].role !== "user") throw fail(422, "Send a question.");

  const opsRes = await fetch(`${api.replace(/\/+$/, "")}/api/ops`);
  if (!opsRes.ok) throw fail(502, "The assistant could not read the census.");
  const snapshot = await opsRes.json();
  const brief = {
    surge: snapshot.surge,
    incoming_notice: snapshot.incoming_notice,
    called_physicians: snapshot.called_physicians,
    diverted_count: snapshot.diverted_count,
    counts: snapshot.counts,
    items: (snapshot.items || []).slice(0, 24),
    usable: (snapshot.usable || []).slice(0, 30),
    holds: snapshot.holds,
    housekeepers: snapshot.housekeepers,
    staff: snapshot.staff,
    beds: (snapshot.beds || []).slice(0, 40),
    units: snapshot.units,
    pending: (snapshot.pending || []).slice(0, 20),
  };

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "x-goog-api-key": key,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: `${SYSTEM}\n\nOperations snapshot:\n${JSON.stringify(brief)}` }],
        },
        contents: turns.map((turn) => ({
          role: turn.role === "user" ? "user" : "model",
          parts: [{ text: turn.content }],
        })),
      }),
    },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw fail(502, data.error?.message || "The assistant could not answer.");
  }
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.map((part) => part.text || "").join("").trim();
  if (!text) throw fail(502, "The assistant returned an empty answer.");
  return text;
}
