// ═══════════════════════════════════════════════════════════════════════════
// PLAIN TEXT → STRUCTURAL TREE (pure; see test/parse.test.js)
// The inverse of toText(): what the app copies pastes back with its structure —
//   "2^3" → 2³ · "(1+2)/3" → a fraction · "√(2)" / "sqrt(2)" → a root ·
//   "sin(x)" → a function · "x²" → x² · "1/2/3" → nested fractions.
// It is equally happy with text from elsewhere (×, ÷, −, **, superscripts,
// 1,000 separators). Anything it does not understand is dropped, so the
// result is always a well-formed tree.
// ═══════════════════════════════════════════════════════════════════════════
import { mkSeq, mkChar, mkFrac, mkSup, mkSqrt, mkFunc, mkParen, FUNC_NAMES } from "./mathAst.js";

const SUPERSCRIPT = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-", "⁺": "+", "⁽": "(", "⁾": ")" };
const FUNCS = new Set(FUNC_NAMES);
const LETTERS = /^[A-Za-z]$/;
// other spellings of the app's functions (the app's log is base 10)
const ALIAS = { log10: "log", arcsin: "asin", arccos: "acos", arctan: "atan", Ans: "ans", ANS: "ans" };
const KNOWN = new Set([...FUNCS, ...Object.keys(ALIAS), "sqrt", "cbrt", "pi", "ans"]);

// A run of letters with the spaces squeezed out ("sin x" → "sinx", "2xsin(x)")
// splits around the longest known names in it; other letters stay single
// variables: "sinx" → sin, x · "xsin" → x, sin · "cosh" → cosh.
function splitName(run) {
  if (KNOWN.has(run)) return [run];
  const out = [];
  let i = 0, loose = "";
  while (i < run.length) {
    let hit = "";
    for (let k = run.length; k > i + 1; k--) if (KNOWN.has(run.slice(i, k))) { hit = run.slice(i, k); break; }
    if (hit) { if (loose) out.push(loose); loose = ""; out.push(hit); i += hit.length; }
    else loose += run[i++];
  }
  if (loose) out.push(loose);
  return out;
}

// ─── Normalise ──────────────────────────────────────────────────────────────
function normalise(text) {
  let s = String(text)
    .replace(/[×·∙⋅]/g, "*").replace(/÷/g, "/").replace(/[−–—]/g, "-")
    .replace(/\*\*/g, "^").replace(/∞/g, "")
    .replace(/[\s ​]+/g, "");
  // runs of superscript characters → ^( … )
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺⁽⁾]+/g, (run) => `^(${[...run].map((c) => SUPERSCRIPT[c]).join("")})`);
  // thousands separators in a copied result ("1,025,000"), only at the top level
  // where a comma has no other meaning (inside gcd(12,345) it separates args)
  let depth = 0, out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    if (c === "," && depth === 0 && /\d/.test(s[i - 1] ?? "") && /^\d{3}(?!\d)/.test(s.slice(i + 1))) continue;
    out += c;
  }
  return out;
}

// ─── Tokenise ───────────────────────────────────────────────────────────────
// num · name · op (+ - * = , % !) · / · ^ · ( · ) · √ · ∛ · |
function tokenize(s) {
  const toks = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      // scientific notation right after a number: 1.5e-7 / 2E3 → the "E" key
      const sci = /^[eE][+-]?\d/.exec(s.slice(j));
      if (sci) {
        let k = j + 1;
        if (s[k] === "+" || s[k] === "-") k++;
        while (k < s.length && /\d/.test(s[k])) k++;
        toks.push({ t: "num", v: s.slice(i, j) + "E" + s.slice(j + 1, k).replace(/^\+/, "") });
        i = k;
      } else {
        toks.push({ t: "num", v: s.slice(i, j) });
        i = j;
      }
    } else if (/[A-Za-z]/.test(c)) {
      let j = i;
      while (j < s.length && /[A-Za-z]/.test(s[j])) j++;
      // a function name may end in digits (log2, log10) when a "(" follows
      let k = j;
      while (k < s.length && /\d/.test(s[k])) k++;
      if (k > j && s[k] === "(" && (FUNCS.has(s.slice(i, k)) || ALIAS[s.slice(i, k)])) j = k;
      for (const name of splitName(s.slice(i, j))) toks.push({ t: "name", v: ALIAS[name] ?? name });
      i = j;
    } else if ("+-*=,%!".includes(c)) { toks.push({ t: "op", v: c }); i++; }
    else if ("/^()√∛|".includes(c)) { toks.push({ t: c }); i++; }
    else if (c === "π") { toks.push({ t: "name", v: "π" }); i++; }
    else i++; // unknown character: dropped
  }
  return toks;
}

// ─── Parse ──────────────────────────────────────────────────────────────────
// A small recursive-descent parser over a flat node sequence. Only "/" and
// "^" change structure; everything else stays a character in the sequence
// (math.js reads the characters with its own precedence rules).
export function parseText(text) {
  const toks = tokenize(normalise(text));
  let p = 0;
  const peek = () => toks[p];
  const unwrap = (nodes) => (nodes.length === 1 && nodes[0].type === "paren" ? nodes[0].inner.children : nodes);

  // one operand with its exponents (and, unless it IS an exponent, postfix ! %):
  // used for a denominator, an exponent and a bare function argument ("sin x").
  // An exponent never takes the "!": 3^2! is (3²)!, as the editor builds it.
  function operand(inExponent = false) {
    const t = peek();
    if (t && t.t === "op" && (t.v === "-" || t.v === "+")) { p++; return [mkChar(t.v), ...operand(inExponent)]; }
    const nodes = primary();
    for (;;) {
      const n = peek();
      if (n && n.t === "^") { p++; nodes.push(mkSup(mkSeq(unwrap(operand(true))))); }
      else if (!inExponent && n && n.t === "op" && (n.v === "!" || n.v === "%")) { p++; nodes.push(mkChar(n.v)); }
      else return nodes;
    }
  }
  function group(close) { // after an opening token: contents up to the matching close
    const inner = seq(close);
    if (peek()?.t === close) p++;
    return inner;
  }
  function primary() {
    const t = peek();
    if (!t) return [];
    p++;
    switch (t.t) {
      case "num": return [...t.v].map(mkChar);
      case "(": {
        const inner = group(")");
        // "((1)/(2))" (older saved text) or "(1/2)+1": the bar already groups
        if (inner.length === 1 && inner[0].type === "frac" && peek()?.t !== "^") return inner;
        return [mkParen(mkSeq(inner))];
      }
      case "|": return [mkFunc("abs", mkSeq(group("|")))];
      case "√": return [mkSqrt(mkSeq(unwrap(primary())))];
      case "∛": return [mkFunc("cbrt", mkSeq(unwrap(primary())))];
      case "name": {
        const v = t.v;
        if (v === "π" || v === "pi") return [mkChar("π")];
        if (v === "ans" || v === "Ans" || v === "ANS") return [mkChar("ans")];
        if (v === "sqrt" || FUNCS.has(v)) {
          const arg = peek()?.t === "(" ? (p++, group(")")) : unwrap(operand());
          return [v === "sqrt" ? mkSqrt(mkSeq(arg)) : mkFunc(v, mkSeq(arg))];
        }
        return [...v].filter((ch) => LETTERS.test(ch)).map(mkChar); // x, e, i, A…, 2xy → x·y
      }
      default: return []; // stray ")" / "^" / "/" with nothing to act on
    }
  }
  function seq(close) {
    const out = [];
    let operandAt = -1; // where the most recent operand starts in `out`
    while (p < toks.length && peek().t !== close) {
      const t = peek();
      if (t.t === ")") { p++; continue; } // unbalanced closer: ignore
      if (t.t === "op") {
        p++;
        out.push(mkChar(t.v));
        if (t.v !== "!" && t.v !== "%") operandAt = -1; // postfix ops stay part of the operand
        continue;
      }
      if (t.t === "/") {
        p++;
        const num = operandAt >= 0 ? out.splice(operandAt) : [];
        const frac = mkFrac(mkSeq(unwrap(num)), mkSeq(unwrap(operand())));
        operandAt = out.length;
        out.push(frac);
        continue;
      }
      if (t.t === "^") {
        p++;
        out.push(mkSup(mkSeq(unwrap(operand(true)))));
        continue; // the exponent belongs to the current operand
      }
      const start = out.length;
      out.push(...primary());
      if (out.length > start) operandAt = start;
    }
    return out;
  }

  return seq(null);
}
