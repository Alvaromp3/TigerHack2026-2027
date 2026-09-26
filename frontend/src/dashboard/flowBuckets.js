export const FLOW_BUCKETS = [
  { id: "admit", label: "Admit", code: "IN", tone: "open" },
  { id: "move", label: "Transfer", code: "MV", tone: "stable" },
  { id: "or", label: "OR", code: "OR", tone: "watch" },
  { id: "discharge", label: "Discharge", code: "OUT", tone: "critical" },
  { id: "divert", label: "Divert", code: "DV", tone: "critical" },
  { id: "death", label: "Death", code: "DTH", tone: "critical" },
  { id: "turnover", label: "Turnover", code: "CLN", tone: "clean" },
];

export function flowBucket(input) {
  const message = typeof input === "string" ? input : input?.message;
  const kind = typeof input === "object" && input ? input.kind : null;
  if (kind === "death") return "death";
  if (kind === "discharge") return "discharge";
  if (kind === "transfer") return "divert";
  if (kind === "admit") return "admit";
  if (kind === "clean") return "turnover";
  const text = (message || "").toLowerCase();
  if (text.includes("died")) return "death";
  if (text.includes("admitted")) return "admit";
  if (text.includes("discharged")) return "discharge";
  if (text.includes("sent to")) return "divert";
  if (text.includes("left the or") || / in or-/.test(text)) return "or";
  if (text.includes(" is open")) return "turnover";
  return "move";
}
