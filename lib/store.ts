// Session store so the screens share a scan without a backend round-trip.
import type { ScannedObject } from "./mock";

const OBJECTS = "sellout.objects";
const NAME = "sellout.name";
const FRAME = "sellout.frame";

// Blob URLs stay valid across client-side navigation within the same document,
// and cost nothing to hold. sessionStorage is the belt for a hard reload.
let frameUrl: string | null = null;
let objects: ScannedObject[] | null = null;

export function saveObjects(objs: ScannedObject[]) {
  objects = objs;
  try { sessionStorage.setItem(OBJECTS, JSON.stringify(objs)); } catch { sessionStorage.removeItem(OBJECTS); }
}

export function loadObjects(): ScannedObject[] | null {
  if (objects) return objects;
  try {
    const raw = sessionStorage.getItem(OBJECTS);
    return raw ? (JSON.parse(raw) as ScannedObject[]) : null;
  } catch { return null; }
}

/** Keep the photo the scan came from, so the review screen can draw on it. */
export function saveFrame(src: Blob | string) {
  if (typeof src === "string") {
    frameUrl = src;
    try { sessionStorage.setItem(FRAME, src); } catch {}
    return;
  }
  frameUrl = URL.createObjectURL(src);
  // A large photo can blow the quota; the in-memory URL is the primary path anyway.
  const reader = new FileReader();
  reader.onload = () => {
    try { sessionStorage.setItem(FRAME, String(reader.result)); } catch {}
  };
  reader.readAsDataURL(src);
}

export function loadFrame(): string | null {
  if (frameUrl) return frameUrl;
  try { return sessionStorage.getItem(FRAME); } catch { return null; }
}

/** Who is using this phone. Captured at the scan, reused to bid with. */
export function saveName(name: string) {
  try { localStorage.setItem(NAME, name.trim().slice(0, 24)); } catch {}
}

export function loadName(): string | null {
  try {
    const n = localStorage.getItem(NAME);
    return n && n.trim() ? n.trim() : null;
  } catch { return null; }
}


let frames: string[] = [];
export function saveFrames(values: string[]) {
  frames = values;
  try { sessionStorage.setItem("sellout.frames", JSON.stringify(values)); } catch { sessionStorage.removeItem("sellout.frames"); }
}
export function loadFrames(): string[] {
  if (frames.length) return frames;
  try { return JSON.parse(sessionStorage.getItem("sellout.frames") || "[]"); } catch { return []; }
}
