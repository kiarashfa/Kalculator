// ═══════════════════════════════════════════════════════════════════════════
// EDITING OPERATIONS on the structural math tree (pure — no React/DOM; see
// test/edit.test.js). The caret is `cur = { seqId, pos }`: an index between
// the children of the seq with that id. Every op takes (root, cur), mutates the
// tree in place when it edits, and returns the new caret.
//
// Navigation walks the tree in reading order (fraction: numerator then
// denominator), so ← / → visit every position you can see exactly once.
// ═══════════════════════════════════════════════════════════════════════════
import {
  mkSeq, mkChar, mkFrac, mkSup, mkSqrt, mkFunc, mkParen,
  findSeq, findParentOf, extractPrecedingOperand, slotsOf, isOperatorChar,
} from "./mathAst.js";
import { parseText } from "./mathParse.js";

const at = (seq, pos) => ({ seqId: seq.id, pos });
const isEmptyNode = (n) => slotsOf(n).every((s) => s.children.length === 0);
export const startOf = (root) => at(root, 0);
export const endOf = (root) => at(root, root.children.length);

// Resolve a caret to its seq, clamping pos; a stale id falls back to the end.
function locate(root, cur) {
  const seq = cur && findSeq(root, cur.seqId);
  if (!seq) return { seq: root, pos: root.children.length };
  return { seq, pos: Math.max(0, Math.min(cur.pos, seq.children.length)) };
}

// Walk up from `seq` through enclosing structures: yields findParentOf() info.
function* ancestors(root, seq) {
  for (let up = findParentOf(root, seq.id); up; up = findParentOf(root, up.parentSeq.id)) yield up;
}

// ─── Navigation ─────────────────────────────────────────────────────────────
export function moveLeft(root, cur) {
  const { seq, pos } = locate(root, cur);
  if (pos > 0) {
    const slots = slotsOf(seq.children[pos - 1]);
    if (slots.length) { const s = slots[slots.length - 1]; return at(s, s.children.length); }
    return at(seq, pos - 1);
  }
  const up = findParentOf(root, seq.id);
  if (!up) return at(seq, pos);
  const slots = slotsOf(up.structNode), k = slots.indexOf(seq);
  if (k > 0) return at(slots[k - 1], slots[k - 1].children.length);
  return at(up.parentSeq, up.structIdx);
}

export function moveRight(root, cur) {
  const { seq, pos } = locate(root, cur);
  if (pos < seq.children.length) {
    const slots = slotsOf(seq.children[pos]);
    if (slots.length) return at(slots[0], 0);
    return at(seq, pos + 1);
  }
  const up = findParentOf(root, seq.id);
  if (!up) return at(seq, pos);
  const slots = slotsOf(up.structNode), k = slots.indexOf(seq);
  if (k < slots.length - 1) return at(slots[k + 1], 0);
  return at(up.parentSeq, up.structIdx + 1);
}

// ↑ — into an adjacent exponent or fraction numerator, else from a denominator
// up to its numerator. Returns null when there is nothing above (the UI then
// uses ↑ for history recall).
export function moveUp(root, cur) {
  const { seq, pos } = locate(root, cur);
  const prev = seq.children[pos - 1], next = seq.children[pos];
  if (next?.type === "sup") return at(next.exp, 0);
  if (prev?.type === "sup") return at(prev.exp, prev.exp.children.length);
  if (prev?.type === "frac") return at(prev.num, prev.num.children.length);
  if (next?.type === "frac") return at(next.num, 0);
  for (const up of ancestors(root, seq)) {
    if (up.structNode.type === "frac" && up.slotName === "den") {
      const num = up.structNode.num, direct = up.structNode.den === seq;
      return at(num, direct && pos < seq.children.length ? Math.min(pos, num.children.length) : num.children.length);
    }
  }
  return null;
}

// ↓ — into an adjacent fraction's denominator, from a numerator down to its
// denominator, or out of an exponent. Returns null when there is nothing below.
export function moveDown(root, cur) {
  const { seq, pos } = locate(root, cur);
  const prev = seq.children[pos - 1], next = seq.children[pos];
  if (prev?.type === "frac") return at(prev.den, prev.den.children.length);
  if (next?.type === "frac") return at(next.den, 0);
  for (const up of ancestors(root, seq)) {
    const t = up.structNode.type;
    if (t === "sup") return at(up.parentSeq, up.structIdx + 1);
    if (t === "frac" && up.slotName === "num") {
      const den = up.structNode.den, direct = up.structNode.num === seq;
      return at(den, direct && pos < seq.children.length ? Math.min(pos, den.children.length) : den.children.length);
    }
  }
  return null;
}

// Home / End: first to the edge of the current slot, then of the whole expression.
export function moveHome(root, cur) {
  const { seq, pos } = locate(root, cur);
  return pos > 0 ? at(seq, 0) : startOf(root);
}
export function moveEnd(root, cur) {
  const { seq, pos } = locate(root, cur);
  return pos < seq.children.length ? at(seq, seq.children.length) : endOf(root);
}

// Leave the innermost structure to the right (the "→|" key). No-op at top level.
export function exitRight(root, cur) {
  const { seq, pos } = locate(root, cur);
  const up = findParentOf(root, seq.id);
  return up ? at(up.parentSeq, up.structIdx + 1) : at(seq, pos);
}

// ")" — close the nearest enclosing ( ), function or root, so sin(1/2) types
// linearly; with none of those around, just leave the innermost structure.
const CLOSABLE = new Set(["paren", "func", "sqrt"]);
export function closeParen(root, cur) {
  const { seq } = locate(root, cur);
  for (const up of ancestors(root, seq)) {
    if (CLOSABLE.has(up.structNode.type)) return at(up.parentSeq, up.structIdx + 1);
  }
  return exitRight(root, cur);
}

// ─── Insertion ──────────────────────────────────────────────────────────────
// Typing one of these at the end of a non-empty exponent leaves it first, so
// x^2+1 types naturally (MathQuill/Desmos behaviour). An empty exponent keeps
// them, so e^-x still works.
const BREAKS_OUT_OF_EXP = new Set(["+", "-", "="]);

export function insertChar(root, cur, ch) {
  let { seq, pos } = locate(root, cur);
  if (BREAKS_OUT_OF_EXP.has(ch) && pos === seq.children.length && pos > 0) {
    const up = findParentOf(root, seq.id);
    if (up && up.structNode.type === "sup") { seq = up.parentSeq; pos = up.structIdx + 1; }
  }
  seq.children.splice(pos, 0, mkChar(ch));
  return at(seq, pos + 1);
}

// Keyboard typing: like insertChar, plus "pi" → π.
export function typeChar(root, cur, ch) {
  const next = insertChar(root, cur, ch);
  if (ch === "i") {
    const seq = findSeq(root, next.seqId), p = next.pos;
    if (seq.children[p - 2]?.value === "p") {
      seq.children.splice(p - 2, 2, mkChar("π"));
      return at(seq, p - 1);
    }
  }
  return next;
}

// Insert ready-made nodes at the caret (paste); the caret lands after them.
export function insertNodes(root, cur, nodes) {
  const { seq, pos } = locate(root, cur);
  seq.children.splice(pos, 0, ...nodes);
  return at(seq, pos + nodes.length);
}

// Paste: text is parsed back into structure (2^3 → 2³, (1+2)/3 → a fraction),
// so copying from the app and pasting keeps the formatting.
export function insertText(root, cur, text) {
  return insertNodes(root, cur, parseText(text));
}

// The operand before the caret, for a fraction slot: a lone ( ) group is
// unwrapped, since the fraction bar already groups — (a+b)/ gives a+b over ▢.
function takeOperandForFraction(seq, pos) {
  const { nodes, start } = extractPrecedingOperand(seq, pos);
  if (nodes.length === 1 && nodes[0].type === "paren") return { nodes: nodes[0].inner.children, start };
  return { nodes, start };
}

// Fraction / root / function / parenthesis. A fraction takes the operand
// before the caret as its numerator (so 1+2 ÷ gives 1+2/▢, not (1+2)/▢).
export function insertStruct(root, cur, type, fnName) {
  const { seq, pos } = locate(root, cur);
  if (type === "frac") {
    const { nodes, start } = takeOperandForFraction(seq, pos);
    const frac = mkFrac(mkSeq(nodes), mkSeq());
    seq.children.splice(start, 0, frac);
    return nodes.length ? at(frac.den, 0) : at(frac.num, 0);
  }
  if (type === "sup") return insertExponent(root, cur, null);
  const slot = mkSeq();
  const node = type === "sqrt" ? mkSqrt(slot) : type === "func" ? mkFunc(fnName, slot) : mkParen(slot);
  seq.children.splice(pos, 0, node);
  return at(slot, 0);
}

// "^" (preset null → empty exponent, caret inside) and x²/x³ (preset "2"/"3"
// → filled, caret after). The exponent raises whatever precedes it:
//   · "^" right after an exponent re-enters that exponent instead of stacking;
//   · x²/x³ on an existing power wraps it first: x³ then x² → (x³)²;
//   · with nothing to raise, an empty ( ) is inserted as the base.
export function insertExponent(root, cur, preset) {
  const { seq, pos } = locate(root, cur);
  const prev = seq.children[pos - 1];
  if (!preset && prev?.type === "sup") return at(prev.exp, prev.exp.children.length);
  let p = pos, baseSlot = null;
  if (!prev || isOperatorChar(prev)) {
    const base = mkParen();
    seq.children.splice(p++, 0, base);
    baseSlot = base.inner;
  } else if (prev.type === "sup") {
    const { nodes, start } = extractPrecedingOperand(seq, pos);
    seq.children.splice(start, 0, mkParen(mkSeq(nodes)));
    p = start + 1;
  }
  const exp = mkSeq(preset ? [...preset].map(mkChar) : []);
  seq.children.splice(p, 0, mkSup(exp));
  if (baseSlot) return at(baseSlot, 0);
  return preset ? at(seq, p + 1) : at(exp, 0);
}

// 1/x: the operand before the caret becomes the DENOMINATOR of 1/▢.
export function insertReciprocal(root, cur) {
  const { seq, pos } = locate(root, cur);
  const { nodes, start } = takeOperandForFraction(seq, pos);
  const frac = mkFrac(mkSeq([mkChar("1")]), mkSeq(nodes));
  seq.children.splice(start, 0, frac);
  return nodes.length ? at(seq, start + 1) : at(frac.den, 0);
}

// "(" — if the letters just before the caret spell a known function (sin,
// sqrt, log2, …) they become that function; otherwise a plain ( ) opens.
export function openParen(root, cur, funcNames) {
  const { seq, pos } = locate(root, cur);
  let i = pos;
  while (i > 0 && seq.children[i - 1].type === "char" && /^[A-Za-z0-9]$/.test(seq.children[i - 1].value)) i--;
  const word = seq.children.slice(i, pos).map((c) => c.value).join("");
  for (let k = 0; k < word.length; k++) {
    const name = word.slice(k); // longest suffix first: "asin" beats "sin"
    if (name === "sqrt" || funcNames.includes(name)) {
      seq.children.splice(i + k, name.length);
      return insertStruct(root, at(seq, i + k), name === "sqrt" ? "sqrt" : "func", name);
    }
  }
  return insertStruct(root, at(seq, pos), "paren");
}

// Wrap the whole expression in a function (suggestion chips: "sin(…)").
export function wrapAll(root, name) {
  const arg = mkSeq(root.children.splice(0));
  root.children.push(name === "sqrt" ? mkSqrt(arg) : mkFunc(name, arg));
  return endOf(root);
}

// ─── Deletion ───────────────────────────────────────────────────────────────
// Backspace never silently flattens a structure (old: 3/4 → 34):
//   · after a structure → step inside it (empty ones are simply deleted);
//   · at the start of a later slot → empty denominator drops the fraction and
//     keeps the numerator (3/▢ → 3); otherwise step back into the earlier slot;
//   · at the start of a single-slot structure → unwrap it (sin(9) → 9, 5² → 52);
//   · at the start of a numerator → step out to the left.
export function backspace(root, cur) {
  const { seq, pos } = locate(root, cur);
  if (pos > 0) {
    const prev = seq.children[pos - 1];
    const slots = slotsOf(prev);
    if (!slots.length || isEmptyNode(prev)) { seq.children.splice(pos - 1, 1); return at(seq, pos - 1); }
    const last = slots[slots.length - 1];
    return at(last, last.children.length);
  }
  const up = findParentOf(root, seq.id);
  if (!up) return at(seq, pos);
  const { structNode: node, parentSeq: parent, structIdx: idx } = up;
  if (isEmptyNode(node)) { parent.children.splice(idx, 1); return at(parent, idx); }
  const slots = slotsOf(node), k = slots.indexOf(seq);
  if (k > 0) {
    if (seq.children.length === 0) {
      const kept = slots.slice(0, k).flatMap((s) => s.children);
      parent.children.splice(idx, 1, ...kept);
      return at(parent, idx + kept.length);
    }
    return at(slots[k - 1], slots[k - 1].children.length);
  }
  if (slots.length === 1) {
    parent.children.splice(idx, 1, ...seq.children);
    return at(parent, idx);
  }
  return at(parent, idx);
}

// Delete (forward): mirror of backspace, stepping into structures from the left.
export function deleteForward(root, cur) {
  const { seq, pos } = locate(root, cur);
  if (pos < seq.children.length) {
    const next = seq.children[pos];
    const slots = slotsOf(next);
    if (!slots.length || isEmptyNode(next)) { seq.children.splice(pos, 1); return at(seq, pos); }
    return at(slots[0], 0);
  }
  const up = findParentOf(root, seq.id);
  if (!up) return at(seq, pos);
  if (isEmptyNode(up.structNode)) { up.parentSeq.children.splice(up.structIdx, 1); return at(up.parentSeq, up.structIdx); }
  return moveRight(root, cur);
}

// ─── Queries ────────────────────────────────────────────────────────────────
// The innermost function / root / ( ) / fraction around the caret — the
// sub-expression whose value the suggestion strip shows ("ln(5) = 1.609438").
const SUBEXPR = new Set(["func", "sqrt", "paren", "frac"]);
export function enclosingNode(root, cur) {
  const { seq } = locate(root, cur);
  for (const up of ancestors(root, seq)) if (SUBEXPR.has(up.structNode.type)) return up.structNode;
  return null;
}
