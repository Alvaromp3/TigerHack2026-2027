import { useEffect, useState } from "react";
import { apiUrl } from "../../api/client";

// Emergency Severity Index: the triage scale US emergency departments and EMS use.
export const ESI = {
  1: { label: "Resuscitation", color: "#b42318", soft: "#fde4e2" },
  2: { label: "Emergent", color: "#ea580c", soft: "#ffedd5" },
  3: { label: "Urgent", color: "#ca8a04", soft: "#fef6d8" },
  4: { label: "Less urgent", color: "#16a34a", soft: "#e7f6ee" },
  5: { label: "Non-urgent", color: "#2563eb", soft: "#e6eefc" },
};

export const COMPLAINTS = [
  { id: "trauma", label: "Trauma" },
  { id: "stroke", label: "Stroke" },
  { id: "cardiac", label: "Chest pain / STEMI" },
  { id: "respiratory", label: "Respiratory" },
  { id: "general", label: "General medical" },
];

export const ZONES = ["Downtown", "North", "East", "South", "West"];

export const UNIT_ORDER = ["ed", "icu", "inpatient", "or"];

export function countdown(seconds) {
  if (seconds == null) return "—";
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

export function secondsUntil(iso, now) {
  if (!iso) return null;
  return (new Date(iso).getTime() - now) / 1000;
}

export function clockTime(iso) {
  if (!iso) return "—";
  const stamp = new Date(iso);
  return Number.isNaN(stamp.getTime()) ? "—" : stamp.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// Where an ambulance is on the region map, from its pickup zone to its hospital.
export function ambulancePosition(run, now) {
  const start = new Date(run.created_at).getTime();
  const end = new Date(run.eta_at).getTime();
  const share = end > start ? Math.min(1, Math.max(0, (now - start) / (end - start))) : 1;
  const { from, to } = run.route;
  return { x: from.x + (to.x - from.x) * share, y: from.y + (to.y - from.y) * share, share };
}

function usePoll(path, every) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let stop = false;
    async function pull() {
      try {
        const res = await fetch(apiUrl(path));
        if (!res.ok) throw new Error(String(res.status));
        const body = await res.json();
        if (!stop) {
          setData(body);
          setError(false);
        }
      } catch {
        if (!stop) setError(true);
      }
    }
    pull();
    const timer = setInterval(pull, every);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [path, every]);
  return { data, error };
}

// Public availability + ambulance traffic, refreshed like a live board.
export function useRegion() {
  const availability = usePoll("/api/public/availability", 5000);
  const traffic = usePoll("/api/public/traffic", 3000);
  return {
    hospitals: availability.data?.hospitals || [],
    zones: availability.data?.zones || [],
    updatedAt: availability.data?.updated_at || null,
    ambulances: traffic.data?.ambulances || [],
    offline: availability.error && !availability.data,
  };
}

export function useNow(every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}
