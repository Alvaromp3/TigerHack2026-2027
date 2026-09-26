export const FLOW_BUCKETS = [
  { id: "admit", label: "Admit", code: "IN", tone: "open" },
  { id: "move", label: "Transfer", code: "MV", tone: "stable" },
  { id: "or", label: "OR", code: "OR", tone: "watch" },
  { id: "discharge", label: "Discharge", code: "OUT", tone: "critical" },
  { id: "divert", label: "Divert", code: "DV", tone: "critical" },
  { id: "turnover", label: "Turnover", code: "CLN", tone: "clean" },
];

export function flowBucket(message) {
  const text = (message || "").toLowerCase();
  if (text.includes("admitted")) return "admit";
  if (text.includes("discharged")) return "discharge";
  if (text.includes("sent to")) return "divert";
  if (text.includes("left the or") || / in or-/.test(text)) return "or";
  if (text.includes(" is open")) return "turnover";
  return "move";
}
