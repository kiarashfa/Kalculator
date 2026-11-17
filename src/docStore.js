// ═══════════════════════════════════════════════════════════════════════════
// Browser storage for documents — IndexedDB database "kalculator", object
// store "kv" (the same one the old single history used, so no upgrade step):
//   docs:index    → [{ id, name, updatedAt, pages }]   one row per document
//   doc:<id>      → the document itself
//   docs:current  → id of the document that was open last
// A document and its index row are written in ONE transaction, so the list
// can never disagree with the documents it lists.
//
// Without IndexedDB (private windows, some embedded browsers) everything works
// from memory for the session and `persistent` is false — the UI then says so
// and points at "Save to file".
//
// Other tabs are told about every write (BroadcastChannel), so a document
// open in two tabs reloads instead of one tab silently overwriting the other.
// ═══════════════════════════════════════════════════════════════════════════
import { sanitizeDoc } from "./docs.js";
import { planMerge, cleanProfile, MAX_REMOVED } from "./workspace.js";
import { markChanged, forgetChanges, writeProfileMirror } from "./local.js";

const DB_NAME = "kalculator";
const STORE = "kv";
const INDEX = "docs:index";
const CURRENT = "docs:current";
const REMOVED = "docs:removed"; // [{ id, at }]: documents deleted here (or on another device), so a merge never brings them back
const PROFILE = "profile";      // the visitor's name and picture
const HISTORY = "history";      // the single list v1 kept (historyDB.js)
const docKey = (id) => `doc:${id}`;

const memory = new Map(); // fallback store (and nothing else)
let dbPromise = null;
export let persistent = typeof indexedDB !== "undefined";

function openDB() {
  if (!persistent) return Promise.reject(new Error("no indexedDB"));
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("blocked"));
    }).catch((e) => { persistent = false; throw e; });
  }
  return dbPromise;
}

// Run `fn(store)` in a transaction; resolves with fn's result once committed.
async function tx(mode, fn) {
  try {
    const db = await openDB();
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const store = t.objectStore(STORE);
      let result;
      Promise.resolve(fn({
        get: (k) => new Promise((res, rej) => { const r = store.get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }),
        put: (k, v) => store.put(v, k),
        del: (k) => store.delete(k),
      })).then((r) => { result = r; }, reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("aborted"));
    });
  } catch (e) {
    if (persistent) throw e; // a real storage error (quota…): let the caller report it
    return fn({ // in-memory fallback
      get: async (k) => memory.get(k),
      put: (k, v) => { memory.set(k, structuredClone(v)); },
      del: (k) => { memory.delete(k); },
    });
  }
}

const row = (doc) => ({ id: doc.id, name: doc.name, updatedAt: doc.updatedAt, pages: doc.pages.filter((p) => p.tree.children.length).length });

// ─── Cross-tab notifications ────────────────────────────────────────────────
const TAB = Math.random().toString(36).slice(2);
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("kalculator-docs") : null;
const listeners = new Set();
// Listeners hear about writes from other tabs and about changes that did not come from this
// tab's editor (a merge from the cloud or a save file, signing out): the open document may then
// need to reload. Messages: saved / deleted { id, updatedAt }, merged, profile, cleared.
export function onStoreChange(cb) {
  listeners.add(cb);
  const h = (e) => { if (e.data?.tab !== TAB) cb(e.data); };
  channel?.addEventListener("message", h);
  return () => { listeners.delete(cb); channel?.removeEventListener("message", h); };
}
// `here`: also tell this tab's own listeners (for changes the editor did not make itself).
const announce = (msg, here = false) => {
  try { channel?.postMessage({ ...msg, tab: TAB }); } catch { /* closed */ }
  if (here) for (const cb of listeners) cb(msg);
};

// ─── API ────────────────────────────────────────────────────────────────────
export async function listDocs() {
  const list = (await tx("readonly", (s) => s.get(INDEX))) || [];
  return (Array.isArray(list) ? list : []).slice().sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadDoc(id) {
  return sanitizeDoc(await tx("readonly", (s) => s.get(docKey(id))));
}

// makeCurrent: this is the document on screen (reopened next launch)
export async function saveDoc(doc, { makeCurrent = true } = {}) {
  let edited = false;
  await tx("readwrite", async (s) => {
    const list = (await s.get(INDEX)) || [];
    const removed = (await s.get(REMOVED)) || [];
    // Only a real edit counts as a change for cloud save; moving between pages does not.
    edited = list.find((r) => r.id === doc.id)?.updatedAt !== doc.updatedAt;
    s.put(docKey(doc.id), doc);
    s.put(INDEX, [row(doc), ...list.filter((r) => r.id !== doc.id)]);
    if (removed.some((r) => r.id === doc.id)) s.put(REMOVED, removed.filter((r) => r.id !== doc.id)); // brought back
    if (makeCurrent) s.put(CURRENT, doc.id);
  });
  if (edited) markChanged();
  announce({ type: "saved", id: doc.id, updatedAt: doc.updatedAt });
}

export async function deleteDoc(id) {
  await tx("readwrite", async (s) => {
    const list = (await s.get(INDEX)) || [];
    const removed = ((await s.get(REMOVED)) || []).filter((r) => r.id !== id);
    s.del(docKey(id));
    s.put(INDEX, list.filter((r) => r.id !== id));
    s.put(REMOVED, [...removed, { id, at: Date.now() }].slice(-MAX_REMOVED));
  });
  markChanged();
  announce({ type: "deleted", id });
}

export async function currentDocId() {
  return tx("readonly", (s) => s.get(CURRENT));
}

// ─── Profile, save files and cloud save ─────────────────────────────────────
export async function readProfile() {
  return cleanProfile(await tx("readonly", (s) => s.get(PROFILE)));
}

// Stores the profile and keeps the header's copy in step.
export async function saveProfile(profile) {
  await tx("readwrite", async (s) => { s.put(PROFILE, profile); });
  writeProfileMirror(profile);
  markChanged();
  announce({ type: "profile" });
}

// Everything that is "you", as the pieces a save file is made of.
export async function readWorkspace() {
  return tx("readonly", async (s) => {
    const index = (await s.get(INDEX)) || [];
    const docs = [];
    for (const r of index) {
      const d = sanitizeDoc(await s.get(docKey(r.id)));
      if (d) docs.push(d);
    }
    return { docs, removed: (await s.get(REMOVED)) || [], profile: cleanProfile(await s.get(PROFILE)), current: (await s.get(CURRENT)) || null };
  });
}

// Joins a parsed save file (or the cloud copy) into this browser, in ONE transaction so another
// tab cannot slip a save in between (workspace.js decides what wins). `prepare(doc)` runs on each
// incoming document that is taken (results are recomputed there, never trusted).
// fromCloud: the data came from the cloud, so it is not a change the cloud still has to receive.
export async function mergeWorkspace(incoming, { prepare = (d) => d, fromCloud = false } = {}) {
  let plan;
  await tx("readwrite", async (s) => {
    const index = (await s.get(INDEX)) || [];
    const removed = (await s.get(REMOVED)) || [];
    const profile = cleanProfile(await s.get(PROFILE));
    plan = planMerge({ docs: index, removed, profile }, incoming);
    const rows = new Map(index.map((r) => [r.id, r]));
    for (const id of plan.drop) { s.del(docKey(id)); rows.delete(id); }
    const byId = new Map(incoming.docs.map((d) => [d.id, d]));
    for (const id of plan.take) {
      const d = prepare(byId.get(id));
      s.put(docKey(id), d);
      rows.set(id, row(d));
    }
    s.put(INDEX, [...rows.values()]);
    s.put(REMOVED, plan.removed);
    if (plan.profile) s.put(PROFILE, plan.profile);
    const current = await s.get(CURRENT);
    if ((!current || !rows.has(current)) && incoming.current && rows.has(incoming.current)) s.put(CURRENT, incoming.current);
  });
  if (plan.profile && plan.profileChanged) writeProfileMirror(plan.profile);
  if (!fromCloud && (plan.take.length || plan.deleted || plan.profileChanged)) markChanged();
  if (plan.take.length || plan.deleted || plan.profileChanged) announce({ type: "merged" }, true);
  return plan;
}

// Removes the documents, the profile and everything else kept about the visitor from this browser.
export async function clearAll() {
  await tx("readwrite", async (s) => {
    const index = (await s.get(INDEX)) || [];
    for (const r of index) s.del(docKey(r.id));
    for (const k of [INDEX, CURRENT, REMOVED, PROFILE, HISTORY]) s.del(k);
  });
  writeProfileMirror(null);
  forgetChanges();
  announce({ type: "cleared" }, true);
}

// Ask the browser not to evict our data under storage pressure (best effort).
export function requestPersistence() {
  try { navigator.storage?.persist?.(); } catch { /* unsupported */ }
}
