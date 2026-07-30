import type { MealMarker } from './types';

/**
 * Meal markers live in the coach's own browser and nowhere else. No account, no
 * table, no row on our side — which also means we cannot restore them if the
 * browser is cleared, so the export button is not a nice-to-have.
 *
 * Keyed by datasetId (see server/cgm/analyse.ts fingerprint): re-uploading the
 * same export brings the markers back, and a different client's file can never
 * pick up the previous client's meals.
 */

const PREFIX = 'upcgm:markers:v1:';
const INDEX_KEY = 'upcgm:datasets:v1';
const MAX_DATASETS = 40;

export interface MarkerFile {
  format: 'upcgm-markers';
  version: 1;
  datasetId: string;
  sourceName?: string;
  exportedAt: string;
  markers: MealMarker[];
}

interface IndexEntry {
  datasetId: string;
  sourceName: string;
  savedAt: number;
  count: number;
}

const available = (): boolean => {
  try {
    // Safari in private mode has localStorage but throws on write, so the probe
    // has to be an actual write.
    const k = '__upcgm_probe__';
    localStorage.setItem(k, '1');
    localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
};

export function loadMarkers(datasetId: string): MealMarker[] {
  if (!available()) return [];
  try {
    const raw = localStorage.getItem(PREFIX + datasetId);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return sanitise(parsed);
  } catch {
    return [];
  }
}

export function saveMarkers(datasetId: string, sourceName: string, markers: MealMarker[]): boolean {
  if (!available()) return false;
  try {
    localStorage.setItem(PREFIX + datasetId, JSON.stringify(markers));
    touchIndex(datasetId, sourceName, markers.length);
    return true;
  } catch {
    // Quota exceeded, most likely. Say so rather than pretending it saved.
    return false;
  }
}

function touchIndex(datasetId: string, sourceName: string, count: number) {
  let list: IndexEntry[] = [];
  try {
    list = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as IndexEntry[];
    if (!Array.isArray(list)) list = [];
  } catch {
    list = [];
  }
  const next = [{ datasetId, sourceName, savedAt: Date.now(), count }, ...list.filter((e) => e.datasetId !== datasetId)];
  // Oldest datasets drop out so a coach who reviews many clients does not slowly
  // fill their browser storage and then lose today's markers to a quota error.
  const trimmed = next.slice(0, MAX_DATASETS);
  for (const dropped of next.slice(MAX_DATASETS)) localStorage.removeItem(PREFIX + dropped.datasetId);
  localStorage.setItem(INDEX_KEY, JSON.stringify(trimmed));
}

export function knownDatasets(): IndexEntry[] {
  if (!available()) return [];
  try {
    const list = JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as IndexEntry[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function toFile(datasetId: string, sourceName: string, markers: MealMarker[]): MarkerFile {
  return { format: 'upcgm-markers', version: 1, datasetId, sourceName, exportedAt: new Date().toISOString(), markers };
}

export interface ImportResult {
  ok: boolean;
  markers: MealMarker[];
  /** set when the file belongs to a different wear than the one on screen */
  mismatch?: { fileDatasetId: string };
  errorTh?: string;
}

export function fromFile(text: string, currentDatasetId: string): ImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, markers: [], errorTh: 'ไฟล์นี้อ่านไม่ออก — ต้องเป็นไฟล์ .json ที่กด “บันทึกมื้ออาหารเป็นไฟล์” ไว้' };
  }
  const obj = parsed as Partial<MarkerFile>;
  if (obj?.format !== 'upcgm-markers') {
    return { ok: false, markers: [], errorTh: 'ไฟล์นี้ไม่ใช่ไฟล์มื้ออาหารของเครื่องมือนี้' };
  }
  const markers = sanitise(obj.markers);
  if (markers.length === 0) {
    return { ok: false, markers: [], errorTh: 'ไฟล์นี้ไม่มีมื้ออาหารที่ใช้ได้' };
  }
  if (obj.datasetId && obj.datasetId !== currentDatasetId) {
    // Loading anyway is a legitimate choice — same person, re-exported file — so
    // this is a confirmation, not a refusal.
    return { ok: true, markers, mismatch: { fileDatasetId: obj.datasetId } };
  }
  return { ok: true, markers };
}

const KINDS = new Set(['breakfast', 'lunch', 'dinner', 'snack', 'drink']);

/** Never trust a file off disk: it may be hand-edited or from an older version. */
function sanitise(input: unknown): MealMarker[] {
  if (!Array.isArray(input)) return [];
  const out: MealMarker[] = [];
  for (const raw of input) {
    const m = raw as Partial<MealMarker>;
    if (typeof m?.t !== 'number' || !Number.isFinite(m.t)) continue;
    if (typeof m.label !== 'string') continue;
    out.push({
      id: typeof m.id === 'string' && m.id ? m.id : newId(),
      t: Math.round(m.t),
      label: m.label.slice(0, 60),
      kind: KINDS.has(String(m.kind)) ? (m.kind as MealMarker['kind']) : 'snack',
      eatingOrder: m.eatingOrder === 'veg-first' || m.eatingOrder === 'carb-first' ? m.eatingOrder : 'unknown',
      walkedAfter: m.walkedAfter === true,
      note: typeof m.note === 'string' ? m.note.slice(0, 240) : undefined,
      createdAt: typeof m.createdAt === 'number' ? m.createdAt : Date.now(),
      updatedAt: typeof m.updatedAt === 'number' ? m.updatedAt : Date.now(),
    });
  }
  return out.sort((a, b) => a.t - b.t);
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `m${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function mergeMarkers(existing: MealMarker[], incoming: MealMarker[]): MealMarker[] {
  const byId = new Map(existing.map((m) => [m.id, m]));
  for (const m of incoming) {
    const prev = byId.get(m.id);
    // Last edit wins. Two devices editing the same marker is rare; silently
    // keeping the older copy would be the confusing outcome.
    if (!prev || m.updatedAt >= prev.updatedAt) byId.set(m.id, m);
  }
  return [...byId.values()].sort((a, b) => a.t - b.t);
}
