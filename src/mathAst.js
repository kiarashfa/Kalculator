// ═══════════════════════════════════════════════════════════════════════════
// STRUCTURAL MATH TREE  (pure, no React/DOM — Node-testable; see test/ast.test.js)
// Nodes: {id, type, ...}
// "seq"   → children[]          (sequence of nodes)
// "char"  → value               (single character/token)
// "frac"  → num(seq), den(seq)  (fraction)
// "sup"   → exp(seq)            (exponent; raises the PRECEDING sibling, like MathQuill)
// "sqrt"  → rad(seq)            (square root)
// "func"  → name, arg(seq)      (named function)
// "paren" → inner(seq)          (parenthesized group)
// ═══════════════════════════════════════════════════════════════════════════

let _nid = 0;
export function nid() { return ++_nid; }

export function mkSeq(ch) { return { id: nid(), type: "seq", children: ch || [] }; }
export function mkChar(v) { return { id: nid(), type: "char", value: v }; }
export function mkFrac(n, d) { return { id: nid(), type: "frac", num: n || mkSeq(), den: d || mkSeq() }; }
export function mkSup(e) { return { id: nid(), type: "sup", exp: e || mkSeq() }; }
export function mkSqrt(r) { return { id: nid(), type: "sqrt", rad: r || mkSeq() }; }
export function mkFunc(name, a) { return { id: nid(), type: "func", name, arg: a || mkSeq() }; }
export function mkParen(c) { return { id: nid(), type: "paren", inner: c || mkSeq() }; }

// AST → flat expression string
export function toExpr(n) {
  if (!n) return "";
  switch (n.type) {
    case "char": return n.value;
    case "seq": {
      let out = "";
      for (const c of n.children) {
        const s = toExpr(c);
        // math.js rejects a number right after ")" (2³4 → "2^(3)4", (1+2)3):
        // make the implied product explicit.
        if (out.endsWith(")") && /^[0-9.]/.test(s)) out += "*";
        out += s;
      }
      return out;
    }
    case "frac": return `((${toExpr(n.num)})/(${toExpr(n.den)}))`;
    // Every structure serializes self-delimited, so "^(e)" binds to exactly the
    // preceding node: 12^(3), sin(x)^(2), ((1)/(2))^(3), (1+2)^(2) all parse right.
    case "sup": return `^(${toExpr(n.exp)})`;
    case "sqrt": return `sqrt(${toExpr(n.rad)})`;
    case "func": return `${n.name}(${toExpr(n.arg)})`;
    case "paren": return `(${toExpr(n.inner)})`;
    default: return "";
  }
}

// Every function that becomes a structural func node — from the keypad or by
// typing its name followed by "(". It is also the evaluator's allowlist (see
// toMathjs), so a new function must be added here AND in mathInstance.js.
export const FUNC_NAMES = [
  "sin", "cos", "tan", "asin", "acos", "atan", "sinh", "cosh", "tanh", "log", "ln", "log2", "abs", "exp", "cbrt",
  "cot", "sec", "coth", "sech", "acot", "asec", "asinh", "acosh", "atanh", "acoth", "asech", // extended trig / hyperbolic
  "gcd", "lcm", "min", "max", "nCr", "nPr", "mod", "logb",            // multi-arg (commas in the single arg seq)
  "mean", "median", "std", "variance", "sum", "mode",                 // statistics (variadic; mode → array result)
  "floor", "ceil", "round",                                           // rounding (typed by name)
];

// AST → human-readable linear text (chips, copy): 2/3 not ((2)/(3)), × − ÷ glyphs.
// It is also the clipboard format: parseText (mathParse.js) reads it back into
// the same structure, so copy → paste keeps fractions, powers and roots.
const TEXT_GLYPH = { "*": "×", "-": "−", ans: "Ans" };
export function toText(n) {
  if (!n) return "";
  // parenthesize a slot unless it is a plain number (2.5) or one self-delimited
  // node — a lone fraction still needs them: √(1/2), 2^(1/2), (1/2)/3
  const plain = (seq) => seq.children.every((c) => c.type === "char" && /^[0-9.]$/.test(c.value))
    || (seq.children.length === 1 && seq.children[0].type !== "frac");
  const group = (seq) => (plain(seq) ? toText(seq) : `(${toText(seq)})`);
  switch (n.type) {
    case "char": return TEXT_GLYPH[n.value] ?? n.value;
    case "seq": return n.children.map(toText).join("");
    case "frac": return `${group(n.num)}/${group(n.den)}`;
    case "sup": return `^${group(n.exp)}`;
    case "sqrt": return `√${group(n.rad)}`;
    case "func": return `${n.name}(${toText(n.arg)})`;
    case "paren": return `(${toText(n.inner)})`;
    default: return "";
  }
}

// AST → LaTeX (context menu "Copy as LaTeX").
const LATEX_FN = new Set(["sin", "cos", "tan", "sinh", "cosh", "tanh", "cot", "sec", "coth", "ln", "log", "exp", "gcd", "min", "max", "arcsin", "arccos", "arctan"]);
const LATEX_ARC = { asin: "arcsin", acos: "arccos", atan: "arctan" };
const LATEX_CHAR = { "*": "\\times ", "/": "\\div ", "π": "\\pi ", ans: "\\mathrm{Ans}", "%": "\\%", E: "\\mathrm{E}" };
export function toLatex(n) {
  if (!n) return "";
  const b = (seq) => "{" + toLatex(seq) + "}";
  const fenced = (open, body, close) => "\\left" + open + body + "\\right" + close;
  switch (n.type) {
    case "char": return LATEX_CHAR[n.value] ?? n.value;
    case "seq": return n.children.map(toLatex).join("").trim();
    case "frac": return "\\frac" + b(n.num) + b(n.den);
    case "sup": return "^" + b(n.exp);
    case "sqrt": return "\\sqrt" + b(n.rad);
    case "paren": return fenced("(", toLatex(n.inner), ")");
    case "func": {
      const arg = toLatex(n.arg);
      if (n.name === "cbrt") return "\\sqrt[3]{" + arg + "}";
      if (n.name === "abs") return fenced("|", arg, "|");
      if (n.name === "exp") return "e^{" + arg + "}";
      if (n.name === "log2") return "\\log_2" + fenced("(", arg, ")");
      const name = LATEX_ARC[n.name] ?? n.name;
      const head = LATEX_FN.has(name) ? "\\" + name : "\\operatorname{" + name + "}";
      return head + fenced("(", arg, ")");
    }
    default: return "";
  }
}

// Function names whose meaning differs between the app's dialect and math.js.
// The app follows calculator convention: log = base 10, ln = natural. math.js
// uses log = natural, log10 = base 10. (log2 / sqrt / cbrt / trig all match.)
const MATHJS_FN_MAP = {
  ln: "log", log: "log10",
  nCr: "combinations", nPr: "permutations", // multi-arg combinatorics
  logb: "log", // log(x, base): math.js `log` is base-aware with 2 args (single-arg `log` → log10 above)
  E: "e", // the "E" key: scientific notation in a number literal (1.5E3 stays intact); a lone E → Euler's number
};

// Translate a flat toExpr() string (app dialect) into a math.js expression:
//   π → pi, log → log10, ln → log; everything else is already compatible
//   (implicit multiplication, ^, !, sqrt(), ans/x as scope vars, e, pi).
//
// `%` is treated as a POSTFIX PERCENT (x% = x/100), the behavior users expect
// from a calculator — NOT math.js's modulo. We rewrite it to `*(1/100)`, which
// attaches to the preceding operand and is safe before a following number
// (the `)` prevents digit-gluing): 50% → 0.5, 200+10% → 200.1, 100*5% → 5.
// (True modulo is exposed separately as mod(a,b) — Phase 4.3.) Edge case: `%`
// binds at multiply precedence, so `50%^2` ≠ `(50%)^2`; unusual, accepted.
//
// SECURITY: expressions can come from typing, pasting or an imported document
// file, and math.js's parser can otherwise reach instance internals —
// config({number:"BigNumber"}) silently reconfigures every later result;
// evaluate/parse/compile are reachable too. So every identifier must be on an
// allowlist (the app's functions + constants/variables); anything else becomes
// a syntax error. The exponent of a number literal (1E3, 2e5) is not a name.
const ALLOWED_NAMES = new Set([
  ...FUNC_NAMES.map((f) => MATHJS_FN_MAP[f] ?? f),
  "sqrt", "pi", "e", "i", "x", "ans", "A", "B", "C", "D", "M",
]);
export function toMathjs(expr) {
  if (!expr) return "";
  return expr
    .replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-") // normalize pretty glyphs (defense-in-depth)
    .replace(/%/g, "*(1/100)")
    .replace(/π/g, "pi")
    .replace(/[A-Za-z][A-Za-z0-9]*/g, (w, at, src) => {
      if (/^[eE]\d+$/.test(w) && /[0-9.]/.test(src[at - 1] ?? "")) return w; // 1E3 / 2e5
      const name = MATHJS_FN_MAP[w] ?? w;
      return ALLOWED_NAMES.has(name) ? name : "@"; // "@" → math.js syntax error
    });
}

// Find seq by id
export function findSeq(node, id) {
  if (!node) return null;
  if (node.id === id && node.type === "seq") return node;
  switch (node.type) {
    case "seq": for (const c of node.children) { const r = findSeq(c, id); if (r) return r; } return null;
    case "frac": return findSeq(node.num, id) || findSeq(node.den, id);
    case "sup": return findSeq(node.exp, id);
    case "sqrt": return findSeq(node.rad, id);
    case "func": return findSeq(node.arg, id);
    case "paren": return findSeq(node.inner, id);
    default: return null;
  }
}

// Slot (child-seq) names for each structural node type, in reading order.
export const NODE_SLOTS = { frac: ["num", "den"], sup: ["exp"], sqrt: ["rad"], func: ["arg"], paren: ["inner"] };

// The slot seqs of a structural node, in reading order ([] for a char).
export function slotsOf(node) {
  const names = node && NODE_SLOTS[node.type];
  return names ? names.map((s) => node[s]) : [];
}

// Deep copy with fresh ids, so a stored/recalled tree can never collide with
// ids already live in the editor.
export function cloneTree(node) {
  if (!node) return node;
  const copy = { ...node, id: nid() };
  if (node.type === "seq") copy.children = node.children.map(cloneTree);
  for (const s of NODE_SLOTS[node.type] || []) copy[s] = cloneTree(node[s]);
  return copy;
}

// Find which seq contains the structural node owning the slot-seq `seqId`.
// Returns { parentSeq, structIdx, structNode, slotName } or null.
// Single traversal: scan a seq's structural children for a direct slot match,
// otherwise recurse into those slots (which are themselves seqs).
export function findParentOf(root, seqId) {
  function search(seq) {
    for (let i = 0; i < seq.children.length; i++) {
      const child = seq.children[i];
      const slots = NODE_SLOTS[child.type];
      if (!slots) continue; // plain char
      for (const slot of slots)
        if (child[slot].id === seqId) return { parentSeq: seq, structIdx: i, structNode: child, slotName: slot };
      for (const slot of slots) {
        const found = search(child[slot]);
        if (found) return found;
      }
    }
    return null;
  }
  if (root.id === seqId) return null; // root has no parent
  return root.type === "seq" ? search(root) : null;
}

// Is this node a char that forms part of a numeric literal (digits / decimal)?
function isNumericChar(node) {
  return node && node.type === "char" && /[0-9.]/.test(node.value);
}
// Is this node a binary/relational operator char (i.e. NOT an operand)?
export function isOperatorChar(node) {
  return node && node.type === "char" && "+-*/^%=×÷−".includes(node.value);
}

// Extract the single operand immediately preceding `pos` in `seq`, removing it
// from seq.children. "Operand" = a full numeric literal (run of digit/decimal
// chars), or a single structural node (frac/sqrt/func/paren) or constant/
// variable char — plus any exponents trailing it (2³ is one operand). A
// preceding operator (or nothing) yields no operand.
//
// Returns { nodes, start }:
//   nodes — the removed operand nodes in order (empty if none)
//   start — the index where the operand began (= insertion point for callers)
export function extractPrecedingOperand(seq, pos) {
  if (pos <= 0) return { nodes: [], start: pos };
  let start = pos;
  while (start > 0 && seq.children[start - 1].type === "sup") start--;
  const prev = seq.children[start - 1];
  if (prev && !isOperatorChar(prev)) {
    start--;
    if (isNumericChar(prev)) while (start > 0 && isNumericChar(seq.children[start - 1])) start--;
  }
  if (start === pos) return { nodes: [], start: pos };
  const nodes = seq.children.splice(start, pos - start);
  return { nodes, start };
}
