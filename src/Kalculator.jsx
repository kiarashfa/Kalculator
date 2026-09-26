import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { mkSeq, mkChar, toExpr, toText, toLatex, cloneTree, FUNC_NAMES } from "./mathAst.js";
import * as Ed from "./mathEdit.js";
import MathView, { caretFromPoint } from "./MathView.jsx";
import { MathEngine, computePage, recomputeDoc } from "./compute.js";
import { loadHistory } from "./historyDB.js";
import * as Store from "./docStore.js";
import {
  MAX_PAGES, MATH_MODES, uid, newDoc, newPage, isBlank, isBlankDoc, isFresh, lastValue,
  uniqueName, cleanName, fileNameFor, toFile, parseFile, docFromHistory, sanitizeDoc,
} from "./docs.js";
import { GraphView, UnitPanel, CurrencyPanel, BasePanel } from "./panels.jsx";
import Icon from "./ui/Icon.jsx";
import Result, { prettyNum, plainNum } from "./ui/Result.jsx";
import InfoSheet from "./ui/InfoSheet.jsx";
import DocsSheet from "./ui/DocsSheet.jsx";
import PagesSheet from "./ui/PagesSheet.jsx";
import ContextMenu from "./ui/ContextMenu.jsx";
import { useToasts, Toasts } from "./ui/Toasts.jsx";

// ─── Preferences (per viewer, not calculation data) → localStorage ──────────
const SETTINGS_KEY = "kalculator.settings";
const SETTINGS_VERSION = 2;
const DEFAULT_SETTINGS = { v: SETTINGS_VERSION, pages: true, suggest: false, preview: true, fnOpen: false };
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    if (s.v !== SETTINGS_VERSION) delete s.suggest; // v2 made suggestions opt-in: reset the old default once
    return { ...DEFAULT_SETTINGS, ...s, v: SETTINGS_VERSION };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
function saveSettings(s) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

function useMedia(query) {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatch(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return match;
}

// Must match the wide-layout media query in styles/app.css.
const WIDE_QUERY = "(min-width: 760px) and (orientation: landscape)";
const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘" : "Ctrl+";

const MODES = [
  { id: "calc", label: "CALC", color: "#f472b6", title: "Calculator" },
  { id: "solve", label: "SOLVE", color: "#60a5fa", title: "Equation solver" },
  { id: "graph", label: "GRAPH", color: "#34d399", title: "Graph f(x)" },
  { id: "calculus", label: "∫dx", color: "#22d3ee", title: "Calculus: derivative & integral" },
  { sep: true },
  { id: "base", label: "BASE", color: "#fb923c", title: "Number bases (DEC/HEX/BIN/OCT)" },
  { id: "units", label: "UNITS", color: "#fbbf24", title: "Unit converter" },
  { id: "fx", label: "FX", color: "#a78bfa", title: "Currency converter" },
];
const MODE_COLOR = Object.fromEntries(MODES.filter((m) => m.id).map((m) => [m.id, m.color]));
const isMathMode = (m) => MATH_MODES.includes(m);

// Display labels for keypad values whose action name differs from the glyph we
// want to show on the (narrow) 5-column keys. The action value itself is unchanged.
const KEY_LABEL = {
  "1/x": "⬚⁻¹", sq: "⬚²", cube: "⬚³", sqrt: "√⬚", cbrt: "³√⬚",
  log2: "log₂", median: "med", variance: "var",
};
// Keys that, pressed right after "=" on an empty page, continue from Ans.
const CONTINUES_ANS = new Set(["+", "-", "*", "/", "^", "%", "!", "sq", "cube", "1/x"]);
// Does a flat expression use the variable x (not the x inside "exp")?
const usesX = (expr) => /(^|[^a-zA-Z])x([^a-zA-Z]|$)/.test(expr);
const HOLD_MS = 480;

async function copyToClipboard(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// ─── Classic layout: one past page as a history entry ──────────────────────
function Entry({ page, latest, copied, onRecall, onCopy, onToggleFraction, onMenu, longPress }) {
  const op = page.out?.op;
  return (
    <div className={`k-entry${latest ? " latest" : ""}`} onContextMenu={onMenu} {...longPress}>
      <div className="k-entry-expr" onClick={onRecall} title="Edit this expression">
        {op?.kind === "int" && <span className="k-opnote">∫<sub>{op.a}</sub><sup>{op.b}</sup></span>}
        {op?.kind === "d" && <span className="k-opnote">d/dx</span>}
        <MathView root={page.tree} />
        {op?.kind === "int" && <span className="k-opnote">dx</span>}
        {op?.kind === "d" && <span className="k-opnote">at x = {op.a}</span>}
      </div>
      <Result out={page.out} stale={!isFresh(page)} copied={copied} onCopy={onCopy} onToggleFraction={onToggleFraction} />
    </div>
  );
}

function SettingToggle({ on, onChange, label, hint }) {
  return (
    <button className="k-toggle" role="switch" aria-checked={on} onClick={() => onChange(!on)}>
      <span>{label}{hint && <small>{hint}</small>}</span>
      <span className={`k-switch${on ? " on" : ""}`} />
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════
export default function Kalculator() {
  const [settings, setSettings] = useState(loadSettings);
  const setSetting = (k, v) => setSettings((s) => ({ ...s, [k]: v }));
  useEffect(() => saveSettings(settings), [settings]);
  const pagesMode = settings.pages;
  const wide = useMedia(WIDE_QUERY);
  const fnOpen = wide || settings.fnOpen;
  const setFnOpen = (v) => setSetting("fnOpen", v);

  // ── The open document ──
  // Pages' trees are edited in place by the pure ops in mathEdit.js; refs
  // hold the source of truth (document, page index, caret) so several keys in
  // one tick never act on stale data. `rev` only triggers the re-render.
  const docRef = useRef(null);
  if (!docRef.current) docRef.current = newDoc();
  const idxRef = useRef(0);
  const curRef = useRef(null);
  if (!curRef.current) curRef.current = Ed.startOf(docRef.current.pages[0].tree);
  const [rev, setRev] = useState(0);
  const bump = () => setRev((r) => r + 1);
  const undoMap = useRef(new Map()); // page id → { past, future }
  const justEvalRef = useRef(false); // right after "=" until the next edit
  const storedIds = useRef(new Set()); // documents that exist in browser storage
  const fileHandles = useRef(new Map()); // doc id → file it was opened from / saved to (this session)
  const loadedRef = useRef(false);

  const [mode, setMode] = useState("calc");
  const [lastAns, setLastAns] = useState(0);
  const [vars, setVarsState] = useState({}); // A, B, C, D, M → value (number | Complex)
  const [graphExprs, setGraphExprs] = useState([]);
  const [showGraph, setShowGraph] = useState(false);
  const [layer, setLayer] = useState(0); // keypad layer: 0 basic · 1 2nd · 2 3rd
  const [caA, setCaA] = useState("0"); // calculus: derivative point / integral lower bound
  const [caB, setCaB] = useState("1"); // calculus: integral upper bound
  const [storeArmed, setStoreArmed] = useState(null); // STO snapshot awaiting a slot
  const [copiedKey, setCopiedKey] = useState(null);
  const [evalError, setEvalError] = useState(null); // "=" failed: the expression stays, the reason shows
  const [showSettings, setShowSettings] = useState(false);
  const [info, setInfo] = useState(null); // null | "guide" | "keys" | "about"
  const [sheet, setSheet] = useState(null); // null | "docs" | "pages"
  const [docList, setDocList] = useState([]);
  const [menu, setMenu] = useState(null); // context menu { x, y, items }
  const { toasts, toast, dismiss } = useToasts();
  const scrollRef = useRef(null);
  const editorRef = useRef(null);
  const fileInputRef = useRef(null);

  const doc = docRef.current;
  if (idxRef.current >= doc.pages.length) idxRef.current = doc.pages.length - 1;
  const page = doc.pages[idxRef.current];
  const curPage = () => docRef.current.pages[idxRef.current];
  const isMath = isMathMode(mode);

  // ── Persistence ──
  const saveTimer = useRef(null);
  const [saveFailed, setSaveFailed] = useState(false);
  async function flushSave() {
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const d = docRef.current;
    if (!loadedRef.current || (isBlankDoc(d) && !storedIds.current.has(d.id))) return; // don't keep empty documents
    try {
      await Store.saveDoc(d);
      storedIds.current.add(d.id);
      if (saveFailed) setSaveFailed(false);
    } catch {
      if (!saveFailed) toast("Couldn't save in this browser — use Save to file to keep your work", { tone: "error", ms: 6000 });
      setSaveFailed(true);
    }
  }
  // Mark the document changed (edited = false: only the open page moved) and
  // save it shortly.
  function touch(edited = true) {
    const d = docRef.current;
    if (edited) d.updatedAt = Date.now();
    d.current = idxRef.current;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushSave, 400);
  }
  const flushRef = useRef(flushSave);
  flushRef.current = flushSave;
  useEffect(() => {
    const flush = () => { if (saveTimer.current) flushRef.current(); };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    const onUnload = (e) => {
      flush();
      if (!Store.persistent && !isBlankDoc(docRef.current)) { e.preventDefault(); e.returnValue = ""; } // work would be lost
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", flush);
    window.addEventListener("beforeunload", onUnload);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", flush);
      window.removeEventListener("beforeunload", onUnload);
    };
  }, []);

  // Open a document object: it becomes the one on screen.
  function openDoc(d, { keepPage = false } = {}) {
    const prevIdx = idxRef.current;
    docRef.current = d;
    undoMap.current = new Map();
    idxRef.current = keepPage ? Math.min(prevIdx, d.pages.length - 1) : Math.min(d.current ?? d.pages.length - 1, d.pages.length - 1);
    setVarsState(d.vars || {});
    setLastAns(lastValue(d));
    setStoreArmed(null);
    justEvalRef.current = false;
    setEvalError(null);
    if (!settingsRef.current.pages) ensureFeedTail();
    const p = curPage();
    curRef.current = Ed.endOf(p.tree);
    setMode((m) => (isMathMode(m) ? p.mode : m));
    bump();
  }
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  // First load: reopen the last document; on the very first run, turn the old
  // single-list history (if any) into a "History" document.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    (async () => {
      let d = null;
      try {
        const id = await Store.currentDocId();
        if (id) d = await Store.loadDoc(id);
        if (!d) {
          const list = await Store.listDocs();
          if (list[0]) d = await Store.loadDoc(list[0].id);
          else {
            const old = await loadHistory();
            if (old.length) { d = docFromHistory(old); await Store.saveDoc(d); }
          }
        }
      } catch { /* storage unavailable: start fresh */ }
      loadedRef.current = true;
      if (d) {
        storedIds.current.add(d.id);
        if (isBlankDoc(docRef.current)) openDoc(d); else touch(); // typed before storage answered: keep that
      } else if (!Store.persistent) {
        toast("This browser can't keep documents (private window?) — use Save to file", { ms: 6000 });
      }
      Store.requestPersistence();
    })();
  }, []);

  // Another tab saved or deleted the document open here.
  useEffect(() => Store.onOtherTabChange(async (msg) => {
    Store.listDocs().then(setDocList).catch(() => {});
    if (msg.id !== docRef.current.id) return;
    if (msg.type === "deleted") { storedIds.current.delete(msg.id); return; }
    if (saveTimer.current) return; // unsaved edits here: they win
    const d = await Store.loadDoc(msg.id);
    if (d && d.updatedAt > docRef.current.updatedAt) openDoc(d, { keepPage: true });
  }), []);

  // ── Scrolling ──
  useEffect(() => { const s = scrollRef.current; if (s && !pagesMode) s.scrollTop = s.scrollHeight; }, [doc.pages.length, mode, pagesMode, doc.id]);
  useEffect(() => {
    const s = scrollRef.current;
    if (!s || typeof ResizeObserver === "undefined") return;
    // Classic is bottom-anchored: when the display shrinks keep the expression in view
    const ro = new ResizeObserver(() => { if (!settingsRef.current.pages) s.scrollTop = s.scrollHeight; });
    ro.observe(s);
    return () => ro.disconnect();
  }, [isMath]);
  useLayoutEffect(() => {
    editorRef.current?.querySelector(".m-caret, .m-slot-on")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [rev]);

  // ── Editing plumbing ──
  const undoOf = (p) => {
    let u = undoMap.current.get(p.id);
    if (!u) undoMap.current.set(p.id, (u = { past: [], future: [] }));
    return u;
  };
  const snapshot = () => ({ tree: JSON.parse(JSON.stringify(curPage().tree)), cur: { ...curRef.current } });
  function record() {
    const u = undoOf(curPage());
    u.past.push(snapshot());
    if (u.past.length > 200) u.past.shift();
    u.future = [];
  }
  function edited() {
    justEvalRef.current = false;
    setEvalError(null);
    touch();
    bump();
  }
  // An editing op (undoable) — op(tree, caret) → caret, from mathEdit.js.
  function edit(op) {
    record();
    curRef.current = op(curPage().tree, curRef.current) || curRef.current;
    edited();
  }
  // A caret move (not undoable). Returns false when the op had nowhere to go.
  function nav(op) {
    const next = op(curPage().tree, curRef.current);
    if (!next) return false;
    curRef.current = next;
    bump();
    return true;
  }
  function setTree(tree, caret) {
    record();
    curPage().tree = tree;
    curRef.current = caret || Ed.endOf(tree);
    edited();
  }
  function restore(from, to) {
    const u = undoOf(curPage());
    if (!u[from].length) return;
    u[to].push(snapshot());
    const s = u[from].pop();
    curPage().tree = s.tree;
    curRef.current = s.cur;
    setEvalError(null);
    touch();
    bump();
  }
  const undo = () => restore("past", "future");
  const redo = () => restore("future", "past");
  function clearAll() {
    if (curPage().tree.children.length) setTree(mkSeq());
    setStoreArmed(null);
  }

  // ── Pages ──
  function goTo(i) {
    const d = docRef.current;
    idxRef.current = Math.max(0, Math.min(d.pages.length - 1, i));
    const p = curPage();
    curRef.current = Ed.endOf(p.tree);
    if (isMathMode(mode)) setMode(p.mode);
    if (p.out?.op) { setCaA(p.out.op.a); if (p.out.op.b !== undefined) setCaB(p.out.op.b); }
    justEvalRef.current = false;
    setEvalError(null);
    touch(false);
    bump();
  }
  // A document holds MAX_PAGES pages; past that, work continues in a new one.
  function appendPage(pageMode) {
    const d = docRef.current;
    if (d.pages.length < MAX_PAGES) { d.pages.push(newPage(pageMode)); return true; }
    const m = /^(.*) · part (\d+)$/.exec(d.name);
    const next = newDoc(m ? `${m[1]} · part ${Number(m[2]) + 1}` : `${d.name} · part 2`);
    next.vars = { ...d.vars };
    next.pages[0].mode = pageMode;
    flushSave();
    openDoc(next);
    toast(`“${d.name}” is full (${MAX_PAGES} pages) — continuing in “${next.name}”`, { ms: 6000 });
    return false;
  }
  // CE: a blank page to type on (the page just left is kept as it is).
  function newPageCmd() {
    const d = docRef.current;
    const keep = justEvalRef.current; // CE right after "=" → "+" still continues from Ans
    if (isBlank(curPage())) return;
    const last = d.pages.length - 1;
    if (isBlank(d.pages[last])) goTo(last);
    else if (appendPage(isMathMode(mode) ? mode : "calc")) goTo(docRef.current.pages.length - 1);
    justEvalRef.current = keep;
  }
  function deletePage(i) {
    const d = docRef.current;
    const removed = d.pages[i];
    if (!removed) return;
    if (d.pages.length === 1) {
      if (isBlank(removed)) return;
      d.pages = [newPage(removed.mode)];
    } else d.pages.splice(i, 1);
    let idx = idxRef.current;
    if (i < idx) idx--;
    goTo(Math.min(idx, d.pages.length - 1));
    if (!settingsRef.current.pages) { ensureFeedTail(); bump(); }
    toast(`Page ${i + 1} deleted`, { action: "Undo", run: () => {
      if (docRef.current !== d) return;
      if (d.pages.length === 1 && isBlank(d.pages[0])) d.pages = [removed];
      else d.pages.splice(Math.min(i, d.pages.length), 0, removed);
      goTo(i);
    } });
  }
  // Classic: the page being typed on is always the last one, never a finished one.
  function ensureFeedTail() {
    const d = docRef.current;
    const last = d.pages[d.pages.length - 1];
    if (!isBlank(last) && isFresh(last)) appendPage(last.mode);
    const dd = docRef.current;
    idxRef.current = dd.pages.length - 1;
    curRef.current = Ed.endOf(dd.pages[idxRef.current].tree);
  }
  useEffect(() => { if (!pagesMode) { ensureFeedTail(); bump(); } }, [pagesMode]);
  function clearClassicHistory() {
    const d = docRef.current;
    const keep = curPage();
    const removed = d.pages.filter((p) => p !== keep && !isBlank(p));
    if (!removed.length) return;
    d.pages = [keep];
    idxRef.current = 0;
    touch();
    bump();
    toast(`Cleared ${removed.length} ${removed.length === 1 ? "entry" : "entries"}`, { action: "Undo", run: () => {
      if (docRef.current !== d) return;
      d.pages = [...removed, ...d.pages];
      idxRef.current = d.pages.length - 1;
      touch();
      bump();
    } });
  }
  // Classic: tap a past entry to bring its expression back to the editor.
  function recall(p) {
    if (!p || isBlank(p)) return;
    curPage().mode = p.mode;
    if (isMathMode(mode)) setMode(p.mode);
    setTree(cloneTree(p.tree));
  }
  function recallLast() {
    const d = docRef.current;
    if (curPage().tree.children.length) return;
    for (let i = idxRef.current - 1; i >= 0; i--) if (!isBlank(d.pages[i])) { recall(d.pages[i]); return; }
  }

  // ── Evaluate ──
  function setVars(next) {
    setVarsState(next);
    const clean = {};
    for (const [k, v] of Object.entries(next)) if (typeof v === "number" && Number.isFinite(v)) clean[k] = v;
    docRef.current.vars = clean;
    touch();
  }
  function calculate(op = null) {
    const p = curPage();
    const r = computePage(p, {
      ans: lastAns, vars,
      op: p.mode === "calculus" ? (op || { kind: "int", a: caA, b: caB }) : null,
    });
    if (!r) return;
    if (r.error) { setEvalError(r.error); return; } // the expression stays so it can be fixed
    p.out = { ...r.out, ...(p.out?.showDecimal && p.out.expr === r.out.expr ? { showDecimal: true } : {}) };
    if (r.ans !== undefined) setLastAns(r.ans);
    if (p.mode === "graph") {
      setGraphExprs((g) => (g.includes(r.out.expr) ? g : [...g, r.out.expr]));
      setShowGraph(true);
    }
    setEvalError(null);
    setStoreArmed(null);
    if (!pagesMode && appendPage(p.mode)) {
      idxRef.current = docRef.current.pages.length - 1;
      curRef.current = Ed.endOf(curPage().tree);
    }
    justEvalRef.current = true;
    touch();
    bump();
  }

  // ── Keys ──
  function pressKey(k) {
    switch (k) {
      case "=": calculate(); return;
      case "EQ": edit((t, c) => Ed.insertChar(t, c, "=")); return; // hold "=": an equals sign
      case "AC": if (pagesMode) newPageCmd(); else clearAll(); return;
      case "CLR": clearAll(); return; // hold ⌫
      case "⌫": edit(Ed.backspace); return;
      case "◀": nav(Ed.moveLeft); return;
      case "▶": nav(Ed.moveRight); return;
      case "ANS": edit((t, c) => Ed.insertChar(t, c, "ans")); return;
      case "(": edit((t, c) => Ed.openParen(t, c, FUNC_NAMES)); return;
      case ")": nav(Ed.closeParen); return;
      default: break;
    }
    const fromAns = justEvalRef.current && mode === "calc" && CONTINUES_ANS.has(k) && isBlank(curPage());
    edit((t, c) => {
      if (fromAns) { t.children.push(mkChar("ans")); c = Ed.endOf(t); }
      if (k === "/") return Ed.insertStruct(t, c, "frac");
      if (k === "^") return Ed.insertExponent(t, c, null);
      if (k === "sq") return Ed.insertExponent(t, c, "2");
      if (k === "cube") return Ed.insertExponent(t, c, "3");
      if (k === "1/x") return Ed.insertReciprocal(t, c);
      if (k === "sqrt") return Ed.insertStruct(t, c, "sqrt");
      if (FUNC_NAMES.includes(k)) return Ed.insertStruct(t, c, "func", k);
      return Ed.insertChar(t, c, k);
    });
  }

  // ── Clipboard ──
  const exprText = () => toText(curPage().tree);
  async function copyText(text, key = null, what = "Copied") {
    if (!text) return;
    const ok = await copyToClipboard(text);
    if (key !== null) {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((c) => (c === key ? null : c)), 1200);
    } else toast(ok ? what : "Copy isn't available here", ok ? {} : { tone: "error" });
  }
  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) edit((t, c) => Ed.insertText(t, c, text));
    } catch {
      toast(`Press ${MOD}V to paste`);
    }
  }
  const resultText = (p) => {
    if (!p?.out || !isFresh(p)) return "";
    if (p.out.solutions?.length) return p.out.solutions.map(plainNum).join(", ");
    return plainNum(p.out.fraction && !p.out.showDecimal ? p.out.fraction : p.out.result);
  };

  // ── Context menu (right-click / long-press) ──
  function openMenu(e, target) {
    e.preventDefault?.();
    const x = e.clientX ?? 0, y = e.clientY ?? 0;
    const p = target === "editor" ? curPage() : docRef.current.pages[target];
    const empty = isBlank(p);
    const items = [];
    if (target === "editor") {
      items.push(
        { label: "Copy", icon: "copy", hint: `${MOD}C`, disabled: empty, run: () => copyText(exprText(), null, "Expression copied") },
        { label: "Cut", icon: "cut", hint: `${MOD}X`, disabled: empty, run: () => { copyText(exprText(), null, "Expression cut"); clearAll(); } },
        { label: "Paste", icon: "paste", hint: `${MOD}V`, run: pasteFromClipboard },
        { label: "Copy as LaTeX", icon: "code", disabled: empty, run: () => copyText(toLatex(p.tree), null, "LaTeX copied") },
      );
      if (resultText(p)) items.push({ label: "Copy result", icon: "copy", run: () => copyText(resultText(p), null, "Result copied") });
      items.push("-",
        { label: "Undo", icon: "undo", hint: `${MOD}Z`, disabled: !undoOf(p).past.length, run: undo },
        { label: "Redo", icon: "redo", hint: `${MOD}Y`, disabled: !undoOf(p).future.length, run: redo },
        { label: "Clear", icon: "eraser", disabled: empty, run: clearAll },
      );
      if (pagesMode) items.push("-",
        { label: "New page", icon: "plus", hint: "Esc", disabled: empty, run: newPageCmd },
        { label: "Delete page", icon: "trash", danger: true, disabled: empty && docRef.current.pages.length === 1, run: () => deletePage(idxRef.current) },
      );
    } else {
      items.push(
        { label: "Copy expression", icon: "copy", run: () => copyText(toText(p.tree), null, "Expression copied") },
        { label: "Copy result", icon: "copy", disabled: !resultText(p), run: () => copyText(resultText(p), null, "Result copied") },
        { label: "Copy as LaTeX", icon: "code", run: () => copyText(toLatex(p.tree), null, "LaTeX copied") },
        "-",
        { label: "Edit again", icon: "edit", run: () => recall(p) },
        { label: "Delete", icon: "trash", danger: true, run: () => deletePage(target) },
      );
    }
    setMenu({ x, y, items });
  }
  // Long-press → the same menu (Android fires contextmenu itself; iOS doesn't).
  const pressRef = useRef({ t: null, x: 0, y: 0 });
  const longPress = (target) => ({
    onPointerDown: (e) => {
      if (e.pointerType !== "touch") return;
      const { clientX: x, clientY: y } = e;
      clearTimeout(pressRef.current.t);
      pressRef.current = { x, y, t: setTimeout(() => { dragRef.current = false; openMenu({ clientX: x, clientY: y }, target); }, 550) };
    },
    onPointerMove: (e) => { if (Math.hypot(e.clientX - pressRef.current.x, e.clientY - pressRef.current.y) > 10) clearTimeout(pressRef.current.t); },
    onPointerUp: () => clearTimeout(pressRef.current.t),
    onPointerCancel: () => clearTimeout(pressRef.current.t),
  });
  const cancelLongPress = () => clearTimeout(pressRef.current.t);

  // ── Documents ──
  const refreshDocList = () => Store.listDocs().then(setDocList).catch(() => setDocList([]));
  function openDocsSheet() { setShowSettings(false); refreshDocList(); setSheet("docs"); }
  async function openDocById(id) {
    await flushSave();
    setSheet(null);
    if (id === docRef.current.id) return;
    const d = await Store.loadDoc(id).catch(() => null);
    if (!d) { toast("That document couldn't be opened", { tone: "error" }); return; }
    storedIds.current.add(d.id);
    openDoc(d);
  }
  async function newDocument() {
    await flushSave();
    const names = (await Store.listDocs().catch(() => [])).map((r) => r.name);
    openDoc(newDoc(uniqueName("Untitled", [...names, docRef.current.name])));
    setSheet(null);
    toast("New document");
  }
  async function renameDoc(id, name) {
    if (id === docRef.current.id) {
      docRef.current.name = cleanName(name, docRef.current.name);
      storedIds.current.add(id); // a named document is worth keeping even if empty
      touch();
      bump();
      await flushSave();
    } else {
      const d = await Store.loadDoc(id).catch(() => null);
      if (d) { d.name = cleanName(name, d.name); d.updatedAt = Date.now(); await Store.saveDoc(d, { makeCurrent: false }); }
    }
    refreshDocList();
  }
  async function duplicateDoc(id) {
    await flushSave();
    const src = id === docRef.current.id ? docRef.current : await Store.loadDoc(id).catch(() => null);
    if (!src) return;
    const names = (await Store.listDocs().catch(() => [])).map((r) => r.name);
    const copy = sanitizeDoc(JSON.parse(JSON.stringify(src)));
    copy.id = uid();
    copy.name = uniqueName(`${src.name} copy`, names);
    copy.createdAt = copy.updatedAt = Date.now();
    storedIds.current.add(copy.id);
    openDoc(copy);
    await flushSave();
    setSheet(null);
    toast(`Duplicated as “${copy.name}”`);
  }
  async function deleteDocById(id) {
    const isCurrent = id === docRef.current.id;
    const snapshot = isCurrent ? JSON.parse(JSON.stringify(docRef.current)) : await Store.loadDoc(id).catch(() => null);
    if (!snapshot) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = null;
    await Store.deleteDoc(id).catch(() => {});
    storedIds.current.delete(id);
    fileHandles.current.delete(id);
    if (isCurrent) {
      const list = await Store.listDocs().catch(() => []);
      const next = list[0] ? await Store.loadDoc(list[0].id).catch(() => null) : null;
      if (next) storedIds.current.add(next.id);
      openDoc(next || newDoc(uniqueName("Untitled", list.map((r) => r.name))));
    }
    refreshDocList();
    toast(`Deleted “${snapshot.name}”`, { action: "Undo", run: async () => {
      const d = sanitizeDoc(snapshot);
      await Store.saveDoc(d, { makeCurrent: isCurrent }).catch(() => {});
      storedIds.current.add(d.id);
      if (isCurrent) openDoc(d);
      refreshDocList();
    } });
  }
  async function saveToFile(id, saveAs = false) {
    await flushSave();
    const d = id === docRef.current.id ? docRef.current : await Store.loadDoc(id).catch(() => null);
    if (!d) return;
    const text = toFile(d);
    if (window.showSaveFilePicker) {
      try {
        let handle = saveAs ? null : fileHandles.current.get(d.id);
        if (!handle) {
          handle = await window.showSaveFilePicker({
            suggestedName: fileNameFor(d.name),
            types: [{ description: "Kalculator document", accept: { "application/json": [".kalc"] } }],
          });
        }
        const w = await handle.createWritable();
        await w.write(text);
        await w.close();
        fileHandles.current.set(d.id, handle);
        bump();
        toast(`Saved to ${handle.name}`);
        return;
      } catch (e) {
        if (e?.name === "AbortError") return; // picker cancelled
        fileHandles.current.delete(d.id); // stale handle / no permission → download instead
      }
    }
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: fileNameFor(d.name) });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast(`Downloaded ${fileNameFor(d.name)}`);
  }
  async function openFile() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({
          types: [{ description: "Kalculator document", accept: { "application/json": [".kalc", ".json"] } }],
        });
        await importFile(await handle.getFile(), handle);
        return;
      } catch (e) {
        if (e?.name === "AbortError") return;
      }
    }
    fileInputRef.current?.click();
  }
  // A .kalc file → a document in this browser (never overwriting one: a
  // different version of a stored document is kept alongside it).
  async function importFile(file, handle = null) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast("That file is too large to be a Kalculator document", { tone: "error" }); return; }
    let parsed;
    try { parsed = parseFile(await file.text()); } catch (e) { toast(e.message, { tone: "error", ms: 5000 }); return; }
    const d = recomputeDoc(parsed.doc); // results are recomputed, never taken from the file
    await flushSave();
    const sig = (x) => JSON.stringify(x.pages.map((p) => [p.mode, toText(p.tree)]));
    const existing = await Store.loadDoc(d.id).catch(() => null);
    if (existing && sig(existing) === sig(d)) {
      storedIds.current.add(existing.id);
      if (handle) fileHandles.current.set(existing.id, handle);
      openDoc(existing);
      setSheet(null);
      toast(`Opened “${existing.name}”`);
      return;
    }
    const names = (await Store.listDocs().catch(() => [])).map((r) => r.name);
    if (existing) { d.id = uid(); d.name = uniqueName(d.name, names); }
    d.updatedAt = Date.now();
    storedIds.current.add(d.id);
    if (handle) fileHandles.current.set(d.id, handle);
    openDoc(d);
    await flushSave();
    setSheet(null);
    const n = d.pages.filter((p) => !isBlank(p)).length;
    toast(`Opened “${d.name}” · ${n} page${n === 1 ? "" : "s"}${parsed.notes.length ? " — " + parsed.notes.join(" ") : ""}`, { ms: 4500 });
  }

  // ── Physical keyboard, captured app-wide ──
  const keyHandlerRef = useRef(null);
  keyHandlerRef.current = (e) => {
    const k = e.key;
    const t = e.target;
    const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
    if (showGraph) { if (k === "Escape") setShowGraph(false); return; }
    if (info || sheet || menu) return; // those handle their own keys
    if (showSettings && k === "Escape") { setShowSettings(false); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (mod && !typing) {
      const lk = k.toLowerCase();
      if (lk === "s") { e.preventDefault(); saveToFile(docRef.current.id, e.shiftKey); return; }
      if (lk === "o") { e.preventDefault(); openFile(); return; }
    }
    if (!isMath || typing) return;
    if (t && t.tagName === "BUTTON" && (k === "Enter" || k === " ")) return; // keyboard-focused button: let it click
    if (mod) {
      const lk = k.toLowerCase();
      if (lk === "z") { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
      else if (lk === "y") { e.preventDefault(); redo(); }
      return; // copy / cut / paste arrive as clipboard events below
    }
    if (e.altKey) {
      if (pagesMode && (k === "ArrowLeft" || k === "ArrowRight")) { e.preventDefault(); goTo(idxRef.current + (k === "ArrowLeft" ? -1 : 1)); }
      return;
    }
    let handled = true;
    switch (k) {
      case "Enter": calculate(); break;
      case "Backspace": edit(Ed.backspace); break;
      case "Delete": edit(Ed.deleteForward); break;
      case "Escape": if (pagesMode) newPageCmd(); else clearAll(); break;
      case "ArrowLeft": nav(Ed.moveLeft); break;
      case "ArrowRight": nav(Ed.moveRight); break;
      case "ArrowUp": if (!nav(Ed.moveUp) && !pagesMode) recallLast(); break;
      case "ArrowDown": nav(Ed.moveDown); break;
      case "Home": nav(Ed.moveHome); break;
      case "End": nav(Ed.moveEnd); break;
      case "PageUp": if (pagesMode) goTo(idxRef.current - 1); else handled = false; break;
      case "PageDown": if (pagesMode) goTo(idxRef.current + 1); else handled = false; break;
      case "Tab": // leave a fraction/exponent; at top level Tab keeps its focus role
        if (curRef.current.seqId !== curPage().tree.id) nav(Ed.exitRight); else handled = false;
        break;
      default:
        if (k.length !== 1) { handled = false; break; }
        if (/^[a-zA-Z]$/.test(k)) edit((tr, c) => Ed.typeChar(tr, c, k));
        else if (k === "=") edit((tr, c) => Ed.insertChar(tr, c, "=")); // equations; Enter evaluates
        else if (/^[0-9.+\-*/^%!,()π]$/.test(k)) pressKey(k);
        else handled = false;
    }
    if (handled) e.preventDefault();
  };
  const clipRef = useRef(null);
  clipRef.current = (e) => {
    if (!isMath || showGraph || info || sheet) return;
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
    if (e.type === "paste") {
      const text = e.clipboardData?.getData("text");
      if (!text) return;
      e.preventDefault();
      edit((tr, c) => Ed.insertText(tr, c, text));
    } else if (window.getSelection()?.isCollapsed !== false && !isBlank(curPage())) {
      e.preventDefault(); // copy / cut with nothing selected: the expression, as re-pastable text
      e.clipboardData?.setData("text/plain", exprText());
      if (e.type === "cut") clearAll();
    }
  };
  useEffect(() => {
    const onKey = (e) => keyHandlerRef.current(e);
    const onClip = (e) => clipRef.current(e);
    window.addEventListener("keydown", onKey);
    for (const ev of ["paste", "copy", "cut"]) window.addEventListener(ev, onClip);
    return () => {
      window.removeEventListener("keydown", onKey);
      for (const ev of ["paste", "copy", "cut"]) window.removeEventListener(ev, onClip);
    };
  }, []);

  // ── Pointer: tap / drag places the caret ──
  const dragRef = useRef(false);
  function placeCaret(e) {
    const c = caretFromPoint(editorRef.current, e.clientX, e.clientY);
    if (c && (c.seqId !== curRef.current.seqId || c.pos !== curRef.current.pos)) { curRef.current = c; bump(); }
  }
  const editorPress = longPress("editor");
  const onEditorPointerDown = (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection / focus jump
    dragRef.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    placeCaret(e);
    editorPress.onPointerDown(e);
  };
  const onEditorPointerMove = (e) => { editorPress.onPointerMove(e); if (dragRef.current) placeCaret(e); };
  const onEditorPointerUp = () => { dragRef.current = false; cancelLongPress(); };

  // Toggle a result between its exact fraction and decimal forms.
  function toggleDecimal(p) {
    if (p.out) { p.out = { ...p.out, showDecimal: !p.out.showDecimal }; touch(); bump(); }
  }

  // ── Variables (STO) ──
  function armStore() {
    if (storeArmed) { setStoreArmed(null); return; } // toggle off
    const expr = toExpr(curPage().tree);
    if (!expr.trim() || expr === "()") return;
    const res = MathEngine.evalRich(expr, { ans: lastAns, ...vars });
    if (res.kind === "real" || res.kind === "complex") setStoreArmed({ value: res.value, display: res.display });
  }
  function onVar(name) {
    if (storeArmed) {
      setVars({ ...vars, [name]: storeArmed.value });
      toast(`Stored ${prettyNum(storeArmed.display)} → ${name}`);
      setStoreArmed(null);
    } else {
      pressKey(name); // recall: use the variable in the expression
    }
  }

  // A math mode belongs to the page. An unfinished expression changes mode
  // with it (typed an equation in CALC → SOLVE it); a finished page keeps its
  // result, and the new mode starts on a fresh page.
  function switchMode(m) {
    setShowSettings(false);
    setEvalError(null);
    if (isMathMode(m) && curPage().mode !== m) {
      if (pagesMode && isFresh(curPage())) newPageCmd();
      curPage().mode = m;
      touch();
    }
    setMode(m); // last: wins over the page-mode sync in goTo()
  }

  // ── Derived display state ──
  const tree = page.tree;
  const flatExpr = useMemo(() => toExpr(tree), [tree, rev]);
  const scope = useMemo(() => ({ ans: lastAns, ...vars }), [lastAns, vars]);
  const isEmpty = tree.children.length === 0;
  const fresh = isFresh(page);
  const cur = curRef.current;

  const preview = useMemo(() => {
    if (evalError) return { text: evalError, cls: "err" };
    if (!flatExpr) return null;
    if (mode === "calc") {
      if (!settings.preview || /^-?[0-9.]+$/.test(flatExpr)) return null; // a bare number previews itself
      const r = MathEngine.evalRich(flatExpr, scope);
      return r.kind === "real" || r.kind === "complex" || r.kind === "infinite" || r.kind === "undefined"
        ? { text: `= ${prettyNum(r.display)}` } : null;
    }
    if (mode === "solve") return { text: usesX(flatExpr) ? "Press = to solve for x · hold = for an equals sign" : "Use x for the unknown", cls: "hint" };
    if (mode === "graph") return { text: "Press = to plot f(x)", cls: "hint" };
    if (mode === "calculus") return { text: `= → ∫ from ${caA} to ${caB}  ·  d/dx → slope at x = ${caA}`, cls: "hint" };
    return null;
  }, [flatExpr, mode, settings.preview, scope, evalError, caA, caB]);

  const suggestions = useMemo(() => {
    if (!settings.suggest || !flatExpr || !(mode === "calc" || mode === "solve" || mode === "graph")) return [];
    const out = [];
    if (mode === "calc") {
      // the value of the sub-expression the caret is in
      const sub = Ed.enclosingNode(tree, cur);
      if (sub) {
        const se = toExpr(sub);
        const v = se !== flatExpr ? MathEngine.evalRich(se, scope) : null;
        if (v && v.kind === "real") out.push({ key: "sub", label: `${toText(sub)} = ${v.display}`, info: true });
      }
      if (!settings.preview) {
        const r = MathEngine.evalRich(flatExpr, scope);
        if (r.kind === "real") out.push({ key: "eval", label: `= ${r.display}`, hot: true, run: () => calculate() });
      }
      const frac = MathEngine.exactFraction(flatExpr, scope);
      if (frac) out.push({ key: "frac", label: `= ${frac}`, info: true });
      if (usesX(flatExpr)) {
        out.push({ key: "solve", label: "Solve for x →", hot: true, run: () => switchMode("solve") });
        out.push({ key: "graph", label: "Graph it →", run: () => switchMode("graph") });
      }
    }
    for (const s of MathEngine.suggest(flatExpr)) {
      if (s.action === "eval") continue;
      const fn = s.action.slice(0, s.action.indexOf("("));
      out.push({ key: fn, label: s.label, run: () => edit((t) => Ed.wrapAll(t, fn)) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatExpr, rev, mode, settings.suggest, settings.preview, scope]);

  // ── Keypad model ──
  // CALC mode shows the imaginary unit `i`; SOLVE/GRAPH show the variable `x`.
  const xi = mode === "calc" ? "i" : "x";
  const layouts = [
    [["1/x","sq","cube","sqrt","cbrt"],["exp","ln","log","log2","logb"],["sin","cos","tan","cot","sec"],["⇧",xi,"π","(",")"]],
    [["gcd","lcm","nCr","nPr","mod"],["abs","min","max","sum","mean"],["mode","median","std","variance",","],["⇧",xi,"π","(",")"]],
    [["asin","acos","atan","acot","asec"],["sinh","cosh","tanh","coth","sech"],["asinh","acosh","atanh","acoth","asech"],["⇧",xi,"π","(",")"]],
  ];
  const fnRows = layouts[layer].slice(0, 3);
  const baseRow = layouts[layer][3];
  const numKeys = [["7","8","9","÷","^"],["4","5","6","×","%"],["1","2","3","−","!"],["0",".","=","+","E"]];
  const keyMap = { "÷": "/", "×": "*", "−": "-" };
  const keyClass = (k) =>
    k === "=" ? "kk kk-eq kk-hold"
    : "÷×−+^%!".includes(k) ? "kk kk-op"
    : /^[0-9.]$/.test(k) ? "kk kk-num"
    : k === "sqrt" || k === "cbrt" ? "kk kk-root"
    : "kk kk-fn";
  const onKeyBtn = (k) => pressKey(keyMap[k] ?? k);

  // Press-and-hold on a key (= types an equals sign, ⌫ clears). A hold
  // swallows the click that follows it.
  const holdRef = useRef({ t: null, fired: false });
  const hold = (onHold) => ({
    onPointerDown: () => {
      holdRef.current.fired = false;
      clearTimeout(holdRef.current.t);
      holdRef.current.t = setTimeout(() => { holdRef.current.fired = true; navigator.vibrate?.(12); onHold(); }, HOLD_MS);
    },
    onPointerUp: () => clearTimeout(holdRef.current.t),
    onPointerLeave: () => clearTimeout(holdRef.current.t),
    onPointerCancel: () => clearTimeout(holdRef.current.t),
    onContextMenu: (e) => e.preventDefault(),
  });
  const tapUnlessHeld = (fn) => () => { if (holdRef.current.fired) { holdRef.current.fired = false; return; } fn(); };

  // ⇧ cycles keypad layers. Tap toggles basic ↔ 2nd (a tap while on 3rd returns
  // to basic); a long-press jumps to the rarely-used 3rd layer. With the
  // function panel folded away (phones), ⇧ first unfolds it.
  const shiftHold = useRef({ t: null, long: false });
  const shiftDown = (e) => { e.preventDefault(); shiftHold.current.long = false; shiftHold.current.t = setTimeout(() => { shiftHold.current.long = true; setLayer(2); setFnOpen(true); }, 450); };
  const shiftUp = () => {
    clearTimeout(shiftHold.current.t);
    if (shiftHold.current.long) return;
    if (!fnOpen) { setFnOpen(true); return; }
    setLayer((l) => (l === 0 ? 1 : 0));
  };
  const shiftCancel = () => { clearTimeout(shiftHold.current.t); };

  // Swipe up / down on the keypad's top row folds the function panel (phones).
  const swipeRef = useRef(null);
  const onToolsPointerDown = (e) => { swipeRef.current = { y: e.clientY, moved: false }; };
  const onToolsPointerMove = (e) => {
    const s = swipeRef.current;
    if (!s || s.moved || wide) return;
    const dy = e.clientY - s.y;
    if (Math.abs(dy) > 24) { s.moved = true; clearTimeout(holdRef.current.t); setFnOpen(dy < 0); }
  };
  const onToolsPointerUp = () => { setTimeout(() => { swipeRef.current = null; }, 0); };
  const tool = (fn) => () => { if (!swipeRef.current?.moved) fn(); };

  const accent = MODE_COLOR[mode] || "#f472b6";
  const undoState = undoOf(page);
  const placeholder = mode === "solve" ? "x² − 4 = 0" : mode === "graph" || mode === "calculus" ? "f(x)" : "0";
  const pageNo = idxRef.current + 1;
  const pageCount = doc.pages.length;
  const onLastPage = idxRef.current === pageCount - 1;
  const openInfo = (tab) => { setShowSettings(false); setInfo(tab); };
  const helpTab = typeof window !== "undefined" && window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ? "keys" : "guide";

  // Classic: every page before the one being typed on is a history entry.
  const entries = pagesMode ? [] : doc.pages.map((p, i) => [p, i]).filter(([p, i]) => i !== idxRef.current && !isBlank(p));
  const latestIdx = !pagesMode && isEmpty && justEvalRef.current ? idxRef.current - 1 : -1;

  const editorBlock = (
    <div className="k-current" onContextMenu={(e) => { cancelLongPress(); openMenu(e, "editor"); }}>
      <div className="k-editor" ref={editorRef} role="textbox" aria-label={isEmpty ? "Expression (empty)" : `Expression: ${toText(tree)}`}
        onPointerDown={onEditorPointerDown} onPointerMove={onEditorPointerMove}
        onPointerUp={onEditorPointerUp} onPointerCancel={onEditorPointerUp}>
        <MathView root={tree} cur={cur} blink={rev} placeholder={isEmpty ? placeholder : null} />
      </div>
      {pagesMode && fresh && !evalError
        ? <Result out={page.out} copied={copiedKey === "cur"} onCopy={(text) => copyText(text, "cur")} onToggleFraction={() => toggleDecimal(page)} />
        : <div className={`k-preview${preview?.cls ? " " + preview.cls : ""}`}>{preview?.text ?? " "}</div>}
    </div>
  );

  return (
    <div className="k-app" style={{ "--accent": accent }}
      onMouseDown={(e) => { if (e.target.closest?.("button")) e.preventDefault(); /* keys never steal focus */ }}
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) e.preventDefault(); }}
      onDrop={(e) => { const f = e.dataTransfer?.files?.[0]; if (f) { e.preventDefault(); importFile(f); } }}>
      {showGraph && <GraphView expressions={graphExprs} onClose={() => setShowGraph(false)} />}
      <input ref={fileInputRef} type="file" accept=".kalc,.json,application/json" hidden
        onChange={(e) => { importFile(e.target.files?.[0]); e.target.value = ""; }} />

      {/* Header: brand · document · mode switcher · settings/help */}
      <header className="k-header">
        <div className="k-brand">
          <button className="k-logo" onClick={() => openInfo("about")} title="About Kalculator">
            {/* The brand mark is the favicon itself (public/icons/favicon.svg), served
                through BASE_URL so it resolves under the GitHub Pages sub-path. */}
            <img src={`${import.meta.env.BASE_URL}icons/favicon.svg`} alt="" width={28} height={28} />
            <span className="k-brand-name">Kalculator</span>
          </button>
          <button className="k-docchip" onClick={openDocsSheet} title="Documents">
            <Icon name="file" size={14} /><span>{doc.name}</span>
          </button>
        </div>
        <nav className="k-modes" aria-label="Mode">
          {MODES.map((m, i) => m.sep
            ? <span key={`sep${i}`} className="k-modes-sep" aria-hidden="true" />
            : <button key={m.id} className={`k-mode${mode === m.id ? " on" : ""}`} style={{ "--c": m.color }}
                aria-pressed={mode === m.id} title={m.title} onClick={() => switchMode(m.id)}>{m.label}</button>
          )}
        </nav>
        <div className="k-actions">
          <button className="k-iconbtn" title="Settings" aria-expanded={showSettings} onClick={() => setShowSettings((s) => !s)}><Icon name="sliders" /></button>
          <button className="k-iconbtn" title="Help & shortcuts" onClick={() => openInfo(helpTab)}>?</button>
        </div>
      </header>

      {showSettings && (
        <>
          <div className="k-pop-scrim" onClick={() => setShowSettings(false)} />
          <div className="k-pop" role="dialog" aria-label="Settings">
            <div className="k-pop-title">Display</div>
            <SettingToggle on={settings.pages} onChange={(v) => setSetting("pages", v)} label="Pages" hint="One calculation per page · off: running history" />
            <SettingToggle on={settings.preview} onChange={(v) => setSetting("preview", v)} label="Live result" hint="Show the answer as you type" />
            <SettingToggle on={settings.suggest} onChange={(v) => setSetting("suggest", v)} label="Suggestions" hint="Hint chips under the expression" />
          </div>
        </>
      )}

      {isMath ? (
        <main className="k-main">
          {/* ── Display ── */}
          <section className={`k-display${pagesMode ? " is-pages" : ""}`}>
            {!pagesMode && (
              <div className="k-disp-tools">
                <button className="k-mini" title={`Undo (${MOD}Z)`} disabled={!undoState.past.length} onClick={undo}><Icon name="undo" size={14} /></button>
                <button className="k-mini" title={`Redo (${MOD}Y)`} disabled={!undoState.future.length} onClick={redo}><Icon name="redo" size={14} /></button>
                {entries.length > 0 && <button className="k-mini" title="Clear history" onClick={clearClassicHistory}><Icon name="trash" size={14} /></button>}
              </div>
            )}
            <div className="k-scroll" ref={scrollRef}>
              <div className={`k-feed${pagesMode ? " k-feed-page" : ""}`}>
                {pagesMode ? (
                  <>
                    {editorBlock}
                    {isEmpty && pageCount === 1 && (
                      <div className="k-empty">
                        <div className="k-empty-glyph">∑</div>
                        <div style={{ color: "#5d6070" }}>Type an expression · = shows the answer here</div>
                        <div>CE starts a new page · ‹ › flip through them</div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    {entries.length === 0 && isEmpty && (
                      <div className="k-empty">
                        <div className="k-empty-glyph">∑</div>
                        <div style={{ color: "#5d6070" }}>Type an expression to get started</div>
                        <div>÷ fractions · ^ exponents · √ roots · <kbd>←</kbd><kbd>→</kbd> move</div>
                      </div>
                    )}
                    {entries.map(([p, i]) => (
                      <Entry key={p.id} page={p}
                        latest={i === latestIdx}
                        copied={copiedKey === p.id}
                        onRecall={() => recall(p)}
                        onCopy={(text) => copyText(text, p.id)}
                        onToggleFraction={() => toggleDecimal(p)}
                        onMenu={(e) => { cancelLongPress(); openMenu(e, i); }}
                        longPress={longPress(i)} />
                    ))}
                    {editorBlock}
                  </>
                )}
              </div>
            </div>

            {suggestions.length > 0 && (
              <div className="k-suggest" aria-label="Suggestions">
                {suggestions.map((s) => (
                  <button key={s.key} className={`k-chip${s.hot ? " hot" : ""}${s.info ? " info" : ""}`} onClick={s.run}>{s.label}</button>
                ))}
              </div>
            )}

            {mode === "calculus" && (
              <div className="k-modebar">
                <label htmlFor="ca-a">a</label>
                <input id="ca-a" className="k-field" value={caA} onChange={(e) => setCaA(e.target.value)} inputMode="decimal" aria-label="lower bound / point a" />
                <label htmlFor="ca-b">b</label>
                <input id="ca-b" className="k-field" value={caB} onChange={(e) => setCaB(e.target.value)} inputMode="decimal" aria-label="upper bound b" />
                <button className="k-btn" onClick={() => calculate({ kind: "d", a: caA })} title="Derivative of f(x) at x=a">d/dx</button>
                <button className="k-btn" onClick={() => calculate({ kind: "int", a: caA, b: caB })} title="∫ from a to b" style={{ fontSize: 14 }}>∫</button>
              </div>
            )}
            {mode === "graph" && (
              <div className="k-modebar">
                <button className="k-btn grow" onClick={() => { if (graphExprs.length) setShowGraph(true); }} disabled={!graphExprs.length}>View graph{graphExprs.length ? ` (${graphExprs.length})` : ""}</button>
                <button className="k-btn ghost grow" onClick={() => setGraphExprs([])} disabled={!graphExprs.length}>Clear plots</button>
              </div>
            )}

            {pagesMode && (
              <nav className="k-pagebar" aria-label="Pages">
                <button className="k-pagebtn" onClick={() => goTo(idxRef.current - 1)} disabled={idxRef.current === 0} title="Previous page (PgUp)"><Icon name="left" size={18} /></button>
                <button className="k-pagebtn sm" title={`Undo (${MOD}Z)`} disabled={!undoState.past.length} onClick={undo}><Icon name="undo" size={15} /></button>
                <button className="k-pagecount" onClick={() => setSheet("pages")} title="All pages">
                  <Icon name="pages" size={14} />{pageNo} / {pageCount}
                </button>
                <button className="k-pagebtn sm" title={`Redo (${MOD}Y)`} disabled={!undoState.future.length} onClick={redo}><Icon name="redo" size={15} /></button>
                {onLastPage
                  ? <button className="k-pagebtn" onClick={newPageCmd} disabled={isEmpty} title="New page (CE)"><Icon name="plus" size={18} /></button>
                  : <button className="k-pagebtn" onClick={() => goTo(idxRef.current + 1)} title="Next page (PgDn)"><Icon name="right" size={18} /></button>}
              </nav>
            )}
          </section>

          {/* ── Keypad ── */}
          <section className={`k-keypad${fnOpen ? " fn-open" : ""}`} aria-label="Keypad">
            <div className="k-tools" onPointerDown={onToolsPointerDown} onPointerMove={onToolsPointerMove} onPointerUp={onToolsPointerUp} onPointerCancel={onToolsPointerUp}>
              <button className="kk kk-tool kk-fntoggle" aria-expanded={fnOpen} title={fnOpen ? "Hide function keys" : "Show function keys"} onClick={tool(() => setFnOpen(!fnOpen))}>
                ƒ<Icon name="up" size={14} />
              </button>
              <button className="kk kk-tool" title="Move left" onClick={tool(() => pressKey("◀"))}><Icon name="left" size={18} /></button>
              <button className="kk kk-tool" title="Move right" onClick={tool(() => pressKey("▶"))}><Icon name="right" size={18} /></button>
              <button className="kk kk-tool" title="Previous answer" onClick={tool(() => pressKey("ANS"))}>ANS</button>
              <button className="kk kk-tool kk-ac" title={pagesMode ? "New page (Esc)" : "Clear (Esc)"} onClick={tool(() => pressKey("AC"))}>{pagesMode ? "CE" : "AC"}</button>
              <button className="kk kk-tool kk-hold" title="Delete · hold to clear" {...hold(() => pressKey("CLR"))} onClick={tapUnlessHeld(tool(() => pressKey("⌫")))}><Icon name="backspace" size={19} /></button>
            </div>

            <div className="k-fnpanel" aria-hidden={!fnOpen}>
              <div className="k-fnpanel-in">
                {mode === "calc" && (
                  <div className="k-vars">
                    <button className={`kk kk-var kk-sto${storeArmed ? " armed" : ""}`} onClick={armStore} title="Store the current value into a variable" tabIndex={fnOpen ? 0 : -1}>{storeArmed ? "STO →" : "STO"}</button>
                    {["A", "B", "C", "D", "M"].map((v) => (
                      <button key={v} className={`kk kk-var${storeArmed ? " armed" : vars[v] !== undefined ? " set" : ""}`} onClick={() => onVar(v)} tabIndex={fnOpen ? 0 : -1}
                        title={vars[v] !== undefined ? `${v} (stored — tap to use)` : `variable ${v}`}>{v}</button>
                    ))}
                  </div>
                )}
                <div className="k-grid k-fngrid">
                  {fnRows.flat().map((k, i) => (
                    <button key={k + i} className={keyClass(k)} onClick={() => onKeyBtn(k)} tabIndex={fnOpen ? 0 : -1}>{KEY_LABEL[k] ?? k}</button>
                  ))}
                </div>
              </div>
            </div>

            <div className="k-grid k-fngrid">
              {baseRow.map((k, i) => k === "⇧"
                ? <button key={k + i} className={`kk kk-shift${layer && fnOpen ? " on" : ""}`} onPointerDown={shiftDown} onPointerUp={shiftUp} onPointerLeave={shiftCancel} onContextMenu={(e) => e.preventDefault()}
                    title={fnOpen ? "Switch function layer (hold: 3rd)" : "Show function keys"}>{fnOpen ? ["⇧", "2nd", "3rd"][layer] : "⇧"}</button>
                : <button key={k + i} className={keyClass(k)} onClick={() => onKeyBtn(k)}>{KEY_LABEL[k] ?? k}</button>
              )}
            </div>
            <div className="k-grid">
              {numKeys.flat().map((k, i) => k === "="
                ? <button key={k + i} className={keyClass(k)} title="Calculate · hold for an = sign" {...hold(() => pressKey("EQ"))} onClick={tapUnlessHeld(() => pressKey("="))}>=</button>
                : <button key={k + i} className={keyClass(k)} onClick={() => onKeyBtn(k)}>{KEY_LABEL[k] ?? k}</button>)}
            </div>
          </section>
        </main>
      ) : (
        <main className="k-main">
          <div className="k-toolpanel">
            {mode === "base" ? <BasePanel /> : mode === "units" ? <UnitPanel /> : mode === "fx" ? <CurrencyPanel /> : null}
          </div>
        </main>
      )}

      <Toasts toasts={toasts} dismiss={dismiss} />
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {info && <InfoSheet tab={info} onTab={setInfo} onClose={() => setInfo(null)} />}
      {sheet === "docs" && (
        <DocsSheet current={doc} pageCount={doc.pages.filter((p) => !isBlank(p)).length} docs={docList}
          persistent={Store.persistent && !saveFailed} fileName={fileHandles.current.get(doc.id)?.name}
          onClose={() => setSheet(null)} onOpen={openDocById} onNew={newDocument} onRename={renameDoc}
          onDuplicate={duplicateDoc} onDelete={deleteDocById} onSaveFile={saveToFile} onOpenFile={openFile} />
      )}
      {sheet === "pages" && (
        <PagesSheet docName={doc.name} pages={doc.pages} current={idxRef.current}
          onGo={(i) => { goTo(i); setSheet(null); }} onDelete={deletePage}
          onNew={() => { newPageCmd(); setSheet(null); }} onDocs={openDocsSheet} onClose={() => setSheet(null)} />
      )}
    </div>
  );
}
