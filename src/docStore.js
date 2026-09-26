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

const DB_NAME = "kalculator";
const STORE = "kv";
const INDEX = "docs:index";
const CURRENT = "docs:current";
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
export function onOtherTabChange(cb) {
  if (!channel) return () => {};
  const h = (e) => { if (e.data?.tab !== TAB) cb(e.data); };
  channel.addEventListener("message", h);
  return () => channel.removeEventListener("message", h);
}
const announce = (msg) => { try { channel?.postMessage({ ...msg, tab: TAB }); } catch { /* closed */ } };

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
  await tx("readwrite", async (s) => {
    const list = (await s.get(INDEX)) || [];
    s.put(docKey(doc.id), doc);
    s.put(INDEX, [row(doc), ...list.filter((r) => r.id !== doc.id)]);
    if (makeCurrent) s.put(CURRENT, doc.id);
  });
  announce({ type: "saved", id: doc.id, updatedAt: doc.updatedAt });
}

export async function deleteDoc(id) {
  await tx("readwrite", async (s) => {
    const list = (await s.get(INDEX)) || [];
    s.del(docKey(id));
    s.put(INDEX, list.filter((r) => r.id !== id));
  });
  announce({ type: "deleted", id });
}

export async function currentDocId() {
  return tx("readonly", (s) => s.get(CURRENT));
}

// Ask the browser not to evict our data under storage pressure (best effort).
export function requestPersistence() {
  try { navigator.storage?.persist?.(); } catch { /* unsupported */ }
}
