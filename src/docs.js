// ═══════════════════════════════════════════════════════════════════════════
// DOCUMENTS & PAGES (pure — no React/DOM/storage; see test/docs.test.js)
// A document is a named workspace of up to MAX_PAGES pages. Each page holds
// one calculation: its expression tree, the mode it belongs to, and `out`, the
// result of its last "=". Both display layouts use the same data: "Pages"
// shows one page at a time; "Classic" shows the pages as a running history.
//
//   doc  = { id, name, createdAt, updatedAt, current, vars: {A: 2.5, …}, pages }
//   page = { id, mode, tree, out }
//   out  = { expr, mode, type: "calc"|"solve"|"graph"|"error", result,
//            value?, fraction?, solutions?, showDecimal?, op?,
//            angle? ("deg"|"rad" when trig was involved), hidden? (graph plot off) }
//
// Documents are kept in the browser (docStore.js) and saved to / opened from
// .kalc files: JSON that also carries each page as readable text.
// ═══════════════════════════════════════════════════════════════════════════
import { mkSeq, mkChar, mkFrac, mkSup, mkSqrt, mkFunc, mkParen, toExpr, toText } from "./mathAst.js";
import { parseText } from "./mathParse.js";

export const MAX_PAGES = 200;
export const MATH_MODES = ["calc", "solve", "graph", "calculus"];
export const FILE_EXT = ".kalc";
const FORMAT = "kalculator-document";
const VERSION = 1;
const MAX_NAME = 60;

export function uid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function newPage(mode = "calc") {
  return { id: uid(), mode: MATH_MODES.includes(mode) ? mode : "calc", tree: mkSeq(), out: null };
}
export function newDoc(name = "Untitled") {
  const now = Date.now();
  return { id: uid(), name: cleanName(name), createdAt: now, updatedAt: now, current: 0, vars: {}, pages: [newPage()] };
}

export const isBlank = (page) => !page || page.tree.children.length === 0;
export const isBlankDoc = (doc) => doc.pages.every(isBlank);
// The stored result still belongs to what is on the page (not edited since "=").
export const isFresh = (page) => !!page?.out && page.out.expr === toExpr(page.tree) && page.out.mode === page.mode;
// Latest real answer in page order — restores Ans when a document is opened.
export function lastValue(doc) {
  for (let i = doc.pages.length - 1; i >= 0; i--) {
    const v = doc.pages[i].out?.value;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return 0;
}

export function cleanName(name, fallback = "Untitled") {
  const n = String(name ?? "").replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_NAME);
  return n || fallback;
}
// "Untitled", "Untitled 2", … — the first name not already taken.
export function uniqueName(base, taken) {
  const used = new Set(taken);
  const b = cleanName(base);
  if (!used.has(b)) return b;
  for (let n = 2; ; n++) if (!used.has(`${b} ${n}`)) return `${b} ${n}`;
}
// A file name that works on every OS: no reserved characters.
export function fileNameFor(name) {
  return cleanName(name).replace(/[\\/:*?"<>|]+/g, "-").replace(/^\.+/, "") + FILE_EXT;
}

// ─── Untrusted input → well-formed data ─────────────────────────────────────
// Everything read back (a file, or storage written by an older version) is
// rebuilt through these: unknown node types, oversized or malformed parts are
// dropped, and every node gets a fresh id. Evaluation has its own allowlist
// (toMathjs), so an odd function name can only ever produce an error.
const CHAR_OK = /^(?:[0-9A-Za-z.+\-*/^%!=,()π]|ans)$/;
const FUNC_OK = /^[A-Za-z][A-Za-z0-9]{0,11}$/;
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : undefined);

export function sanitizeTree(node, depth = 0) {
  if (!node || node.type !== "seq" || !Array.isArray(node.children) || depth > 40) return mkSeq();
  const sub = (n) => sanitizeTree(n, depth + 1);
  const kids = [];
  for (const c of node.children.slice(0, 2000)) {
    if (!c || typeof c !== "object") continue;
    if (c.type === "char") { if (typeof c.value === "string" && CHAR_OK.test(c.value)) kids.push(mkChar(c.value)); }
    else if (c.type === "frac") kids.push(mkFrac(sub(c.num), sub(c.den)));
    else if (c.type === "sup") kids.push(mkSup(sub(c.exp)));
    else if (c.type === "sqrt") kids.push(mkSqrt(sub(c.rad)));
    else if (c.type === "func") { if (typeof c.name === "string" && FUNC_OK.test(c.name)) kids.push(mkFunc(c.name, sub(c.arg))); }
    else if (c.type === "paren") kids.push(mkParen(sub(c.inner)));
  }
  return mkSeq(kids);
}

export function sanitizeOut(out) {
  if (!out || typeof out !== "object" || typeof out.result !== "string") return null;
  const clean = {
    expr: str(out.expr, 5000) ?? "",
    mode: MATH_MODES.includes(out.mode) ? out.mode : "calc",
    type: ["calc", "solve", "graph", "error"].includes(out.type) ? out.type : "calc",
    result: out.result.slice(0, 400),
  };
  if (typeof out.value === "number" && Number.isFinite(out.value)) clean.value = out.value;
  if (str(out.fraction, 80)) clean.fraction = str(out.fraction, 80);
  if (Array.isArray(out.solutions)) clean.solutions = out.solutions.filter((s) => typeof s === "string").slice(0, 60).map((s) => s.slice(0, 120));
  if (out.showDecimal === true) clean.showDecimal = true;
  if (out.angle === "deg" || out.angle === "rad") clean.angle = out.angle;
  if (out.hidden === true) clean.hidden = true;
  if (out.op && (out.op.kind === "int" || out.op.kind === "d")) {
    clean.op = { kind: out.op.kind, a: str(out.op.a, 40) ?? "0" };
    if (out.op.kind === "int") clean.op.b = str(out.op.b, 40) ?? "1";
  }
  return clean;
}

function sanitizeVars(vars) {
  const out = {};
  if (vars && typeof vars === "object") {
    for (const k of ["A", "B", "C", "D", "M"]) if (typeof vars[k] === "number" && Number.isFinite(vars[k])) out[k] = vars[k];
  }
  return out;
}

function sanitizePage(p) {
  if (!p || typeof p !== "object") return null;
  // the tree is authoritative; the readable text is the fallback
  const tree = p.tree ? sanitizeTree(p.tree) : mkSeq(parseText(str(p.text, 5000) ?? ""));
  const page = newPage(p.mode);
  page.tree = tree;
  page.out = sanitizeOut(p.out);
  return page;
}

// A document from storage or a file → a well-formed document (or null).
export function sanitizeDoc(d) {
  if (!d || typeof d !== "object" || !Array.isArray(d.pages)) return null;
  const now = Date.now();
  const pages = d.pages.slice(0, MAX_PAGES).map(sanitizePage).filter(Boolean);
  if (!pages.length) pages.push(newPage());
  const time = (t) => (typeof t === "number" && Number.isFinite(t) ? t : now);
  return {
    id: typeof d.id === "string" && /^[\w-]{6,64}$/.test(d.id) ? d.id : uid(),
    name: cleanName(d.name),
    createdAt: time(d.createdAt),
    updatedAt: time(d.updatedAt),
    current: Math.max(0, Math.min(pages.length - 1, Number.isInteger(d.current) ? d.current : pages.length - 1)),
    vars: sanitizeVars(d.vars),
    pages,
  };
}

// ─── Files (.kalc) ──────────────────────────────────────────────────────────
// Trees are stored without their runtime ids; every page also carries its
// readable text, so a file stays useful to a human (and to future versions).
function packTree(n) {
  if (!n) return n;
  const { id, ...rest } = n;
  if (rest.children) rest.children = rest.children.map(packTree);
  for (const k of ["num", "den", "exp", "rad", "arg", "inner"]) if (rest[k]) rest[k] = packTree(rest[k]);
  return rest;
}

export function toFile(doc) {
  return JSON.stringify({
    format: FORMAT,
    version: VERSION,
    app: "Kalculator",
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    vars: sanitizeVars(doc.vars),
    pages: doc.pages.filter((p) => !isBlank(p)).map((p) => ({
      mode: p.mode,
      text: toText(p.tree),
      tree: packTree(p.tree),
      out: p.out || undefined,
    })),
  }, null, 1);
}

// Text of a .kalc file → { doc, notes[] }. Throws an Error with a message fit
// to show the user when the file is not a Kalculator document.
export function parseFile(text) {
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("This file isn't a Kalculator document (it isn't valid JSON)."); }
  if (!data || data.format !== FORMAT || !Array.isArray(data.pages)) throw new Error("This file isn't a Kalculator document.");
  const notes = [];
  if (typeof data.version === "number" && data.version > VERSION) notes.push("It was saved by a newer version of Kalculator; some details may be missing.");
  if (data.pages.length > MAX_PAGES) notes.push(`Only the first ${MAX_PAGES} pages were opened.`);
  const doc = sanitizeDoc({ ...data, current: data.pages.length - 1 });
  return { doc, notes };
}

// ─── Migration from the single-list history (≤ Sep 2026) ───────────────────
// Each old entry becomes a page with its result; entries saved before trees
// existed are rebuilt from their text.
export function docFromHistory(entries, name = "History") {
  const doc = newDoc(name);
  const pages = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!e || typeof e !== "object" || typeof e.expr !== "string" || e.expr.startsWith("STO")) continue;
    const mode = e.op ? "calculus" : e.type === "solve" ? "solve" : e.type === "graph" ? "graph" : "calc";
    const page = newPage(mode);
    page.tree = e.tree ? sanitizeTree(e.tree) : mkSeq(parseText(e.expr));
    if (!page.tree.children.length) continue;
    const value = typeof e.result === "string" ? Number(e.result.replace(/,/g, "")) : NaN;
    page.out = sanitizeOut({
      expr: toExpr(page.tree), mode, type: e.type, result: String(e.result ?? ""),
      value: Number.isFinite(value) ? value : undefined,
      fraction: e.fraction, solutions: e.solutions, showDecimal: e.showDecimal, op: e.op,
    });
    pages.push(page);
  }
  doc.pages = [...pages.slice(-(MAX_PAGES - 1)), newPage()];
  doc.current = doc.pages.length - 1;
  return doc;
}
