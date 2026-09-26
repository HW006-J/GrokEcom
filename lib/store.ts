// Tiny session store so screens share scan results without a backend round-trip.
import type { ScannedObject } from "./mock";

const KEY = "sellout.objects";

export function saveObjects(objs: ScannedObject[]) {
  try { sessionStorage.setItem(KEY, JSON.stringify(objs)); } catch {}
}

export function loadObjects(): ScannedObject[] | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ScannedObject[]) : null;
  } catch { return null; }
}
