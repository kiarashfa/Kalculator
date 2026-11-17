// ═══════════════════════════════════════════════════════════════════════════
// The save file (pure — no React/DOM/storage; see test/workspace.test.js).
// There are no accounts: a save file holds everything that is "you" (the
// profile and every document) and opening one is how you sign in. The same
// data is what cloud save keeps in your own Google Drive or Dropbox.
//
//   { format: "kalculator-save", version: 1, app, savedAt, current,
//     profile?: { name, picture (small image or null), createdAt, updatedAt },
//     documents: [ packed documents, as in a .kalc file ],
//     removed: [ { id, at } ] }          ← documents deleted somewhere
//
// Two copies (this browser and a file or cloud copy) are joined by planMerge:
// per document the newer edit wins, a document deleted after its last edit
// stays deleted, and the newer profile wins. Nothing is ever merged page by
// page: a document is always taken whole from one side.
// ═══════════════════════════════════════════════════════════════════════════
import { packDoc, unpackDoc } from "./docs.js";

export const SAVE_FORMAT = "kalculator-save";
export const SAVE_VERSION = 1;
const MAX_DOCS = 500;
const MAX_CHARS = 60_000_000;
/** Deletion records kept (the oldest go first). */
export const MAX_REMOVED = 500;

export const NAME_MAX = 40;
/** A 192 px WebP is 5 to 15 KB as a data URL; anything far past that is not ours. */
export const PICTURE_MAX = 120_000;

// ─── Profile ────────────────────────────────────────────────────────────────
const PICTURE_RE = /^data:image\/(?:webp|jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/;

export function cleanName(name) {
  return String(name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);
}

/** The initials shown when there is no photo: one name gives one letter, two or more give the
 * first letters of the first two. "Ada" → "A", "Ada Lovelace" → "AL", "Jean Claude Van Damme" → "JC". */
export function initialsOf(name) {
  return cleanName(name).split(" ").filter(Boolean).slice(0, 2).map((w) => [...w][0]).join("").toUpperCase();
}

const time = (t, fallback) => (typeof t === "number" && Number.isFinite(t) ? t : fallback);

/** Untrusted profile data → a well-formed profile, or null. */
export function cleanProfile(raw) {
  if (!raw || typeof raw !== "object") return null;
  const now = Date.now();
  const name = cleanName(raw.name);
  const picture = typeof raw.picture === "string" && raw.picture.length <= PICTURE_MAX && PICTURE_RE.test(raw.picture) ? raw.picture : null;
  const updatedAt = time(raw.updatedAt, now);
  return {
    name,
    picture,
    createdAt: time(raw.createdAt, updatedAt),
    updatedAt,
  };
}

// ─── The file ───────────────────────────────────────────────────────────────
/** Pieces of a workspace → the plain object that is written to a save file. */
export function packWorkspace({ docs, removed = [], profile = null, current = null }) {
  const out = {
    format: SAVE_FORMAT,
    version: SAVE_VERSION,
    app: "Kalculator",
    savedAt: new Date().toISOString(),
    current: current && docs.some((d) => d.id === current) ? current : docs[0]?.id ?? null,
  };
  if (profile) out.profile = profile;
  out.documents = docs.map(packDoc);
  if (removed.length) out.removed = removed;
  return out;
}

export const serializeWorkspace = (parts) => JSON.stringify(packWorkspace(parts), null, 1);

const cleanRemoved = (list) => {
  const latest = new Map();
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || typeof r.id !== "string" || !/^[\w-]{6,64}$/.test(r.id) || typeof r.at !== "number" || !Number.isFinite(r.at)) continue;
    const seen = latest.get(r.id);
    if (!seen || r.at > seen.at) latest.set(r.id, { id: r.id, at: r.at });
  }
  return [...latest.values()].sort((a, b) => a.at - b.at).slice(-MAX_REMOVED);
};

/** True when parsed JSON is a save file (as opposed to a single document). */
export const isSaveData = (data) => !!data && typeof data === "object" && data.format === SAVE_FORMAT;

/** Untrusted save data → { ok, workspace: { docs, removed, profile, current, notes } } or { ok: false, error }. Never throws. */
export function readWorkspace(data) {
  if (!isSaveData(data)) return { ok: false, error: "This file isn't a Kalculator save file." };
  if (typeof data.version === "number" && data.version > SAVE_VERSION) {
    return { ok: false, error: "This save was made by a newer version of Kalculator. Reload the page to update, then try again." };
  }
  if (!Array.isArray(data.documents)) return { ok: false, error: "This save file is damaged or incomplete." };
  const notes = [];
  const byId = new Map();
  for (const raw of data.documents.slice(0, MAX_DOCS)) {
    const unpacked = unpackDoc(raw);
    if (!unpacked) continue;
    const d = unpacked.doc;
    const seen = byId.get(d.id);
    if (!seen || d.updatedAt >= seen.updatedAt) byId.set(d.id, d);
  }
  if (data.documents.length > MAX_DOCS) notes.push(`Only the first ${MAX_DOCS} documents were read.`);
  const docs = [...byId.values()];
  const current = typeof data.current === "string" && byId.has(data.current) ? data.current : docs[0]?.id ?? null;
  return { ok: true, workspace: { docs, removed: cleanRemoved(data.removed), profile: cleanProfile(data.profile), current, notes } };
}

/** Text of a save file or of the cloud copy → same result as readWorkspace. */
export function parseWorkspace(text) {
  if (typeof text !== "string" || text.length > MAX_CHARS) return { ok: false, error: "This file is too large to be a Kalculator save file." };
  let data;
  try { data = JSON.parse(text); } catch { return { ok: false, error: "This isn't a Kalculator save file (it isn't valid JSON)." }; }
  return readWorkspace(data);
}

// ─── Merging ────────────────────────────────────────────────────────────────
/**
 * What joining `incoming` into this browser would do, decided from the browser's
 * index only (so it needs no document bodies):
 *   local    = { docs: [{ id, updatedAt }], removed: [{ id, at }], profile }
 *   incoming = a parsed workspace
 * → { take: [ids of incoming documents to store], drop: [ids of local documents to
 *     delete], removed (the records to keep), profile, added, updated, deleted,
 *     profileChanged, localAhead (this browser holds something the incoming copy lacks) }
 */
export function planMerge(local, incoming) {
  const mine = new Map(local.docs.map((d) => [d.id, d.updatedAt]));
  const theirs = new Map(incoming.docs.map((d) => [d.id, d.updatedAt]));
  const theirTombs = new Map(incoming.removed.map((r) => [r.id, r.at]));
  const tomb = new Map();
  for (const r of [...local.removed, ...incoming.removed]) {
    const seen = tomb.get(r.id);
    if (seen === undefined || r.at > seen) tomb.set(r.id, r.at);
  }
  const plan = { take: [], drop: [], removed: [], profile: null, added: 0, updated: 0, deleted: 0, profileChanged: false, localAhead: false };
  const alive = new Set();

  for (const id of new Set([...mine.keys(), ...theirs.keys()])) {
    const l = mine.get(id);
    const i = theirs.get(id);
    const useIncoming = i !== undefined && (l === undefined || i > l);
    const winner = useIncoming ? i : l;
    const t = tomb.get(id);
    if (t !== undefined && winner <= t) { // deleted after its last edit: stays deleted
      if (l !== undefined) { plan.drop.push(id); plan.deleted++; }
      continue;
    }
    alive.add(id);
    if (useIncoming) { plan.take.push(id); if (l === undefined) plan.added++; else plan.updated++; }
    else if (i === undefined || l > i) plan.localAhead = true;
  }
  for (const r of local.removed) {
    const seen = theirTombs.get(r.id);
    if (seen === undefined || r.at > seen) plan.localAhead = true; // the other copy has not heard of this deletion
  }
  plan.removed = [...tomb].filter(([id]) => !alive.has(id)).map(([id, at]) => ({ id, at })).sort((a, b) => a.at - b.at).slice(-MAX_REMOVED);

  const a = local.profile, b = incoming.profile;
  if (!a || !b) {
    plan.profile = a || b || null;
    plan.profileChanged = !a && !!b;
  } else {
    const takeB = b.updatedAt > a.updatedAt;
    const newer = takeB ? b : a;
    plan.profile = { ...newer, createdAt: Math.min(a.createdAt, b.createdAt) };
    plan.profileChanged = takeB;
  }
  if (local.profile && (!b || local.profile.updatedAt > b.updatedAt)) plan.localAhead = true;
  return plan;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "2 new documents, 1 updated and your profile", or "" when a merge brought nothing. */
export function describeMerge(plan) {
  const parts = [
    plan.added && `${plural(plan.added, "new document", "new documents")}`,
    plan.updated && `${plan.updated} updated`,
    plan.deleted && `${plan.deleted} removed`,
    plan.profileChanged && "your profile",
  ].filter(Boolean);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] || "";
}

/** A file name that works on every OS: "Kalculator save 2026-11-17.kalcsave". */
export function saveFileName(date = new Date(), ext = ".kalcsave") {
  return `Kalculator save ${date.toISOString().slice(0, 10)}${ext}`;
}
