// ═══════════════════════════════════════════════════════════════════════════
// Evaluating a page — the one place "=" turns an expression into a result.
// Used by the "=" key and when a document is opened from a file (results in a
// file are recomputed, never trusted).
// ═══════════════════════════════════════════════════════════════════════════
import { math, mathFrac } from "./mathInstance.js";
import { createMathEngine } from "./mathjsEngine.js";
import { toExpr } from "./mathAst.js";

// math.js-backed engine (eval/solve/graph) + a Fraction-mode instance for exact
// results. Built once at module load.
export const MathEngine = createMathEngine(math, mathFrac);

// page + context → { out } on success, { error } with a message otherwise, or
// null for an empty page. ctx: { ans, vars, op } where op (calculus pages) is
// { kind: "int", a, b } or { kind: "d", a }.
export function computePage(page, { ans = 0, vars = {}, op = null } = {}) {
  const expr = toExpr(page.tree);
  if (!expr.trim() || expr === "()") return null;
  const base = { expr, mode: page.mode };

  if (page.mode === "solve") {
    const r = MathEngine.solve(expr);
    return { out: { ...base, type: "solve", result: r.display, solutions: r.kind === "roots" ? r.solutions : undefined } };
  }
  if (page.mode === "graph") return { out: { ...base, type: "graph", result: "Plotted ✓" } };
  if (page.mode === "calculus") {
    const o = op || { kind: "int", a: "0", b: "1" };
    const a = parseFloat(o.a), b = parseFloat(o.b);
    if (isNaN(a) || (o.kind === "int" && isNaN(b))) return { error: o.kind === "int" ? "Integral bounds a and b must be numbers" : "Point a must be a number" };
    const r = o.kind === "int" ? MathEngine.numIntegral(expr, a, b) : MathEngine.numDerivative(expr, a);
    if (r === null) return { error: o.kind === "int" ? "Can't integrate this — check f(x)" : "Can't differentiate this — check f(x)" };
    return { out: { ...base, type: "calc", result: MathEngine.fmt(r), value: r, op: o.kind === "int" ? { kind: "int", a: o.a, b: o.b } : { kind: "d", a: o.a } } };
  }

  const scope = { ans, ...vars };
  const res = MathEngine.evalRich(expr, scope);
  if (res.kind === "real") {
    const fraction = MathEngine.exactFraction(expr, scope);
    return { out: { ...base, type: "calc", result: res.display, value: res.value, ...(fraction ? { fraction } : {}) }, ans: res.value };
  }
  if (res.kind === "complex") return { out: { ...base, type: "calc", result: res.display }, ans: res.value };
  if (res.kind === "infinite" || res.kind === "undefined") return { out: { ...base, type: "error", result: res.display } };
  return { error: "Can't evaluate this — check the expression" };
}

// Recompute every page that has a result (opening a file), in page order so
// Ans flows from one page to the next as it did when the file was made.
export function recomputeDoc(doc) {
  let ans = 0;
  for (const page of doc.pages) {
    if (!page.out) continue;
    const r = computePage(page, { ans, vars: doc.vars, op: page.out.op });
    page.out = r?.out ? { ...r.out, ...(page.out.showDecimal ? { showDecimal: true } : {}) } : null;
    if (r?.ans !== undefined && typeof r.ans === "number") ans = r.ans;
  }
  return doc;
}
