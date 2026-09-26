// Tests for the math.js-backed engine. Loads math.js from the installed
// `mathjs` package when present (CI / dev), and otherwise from a vendored
// browser bundle at test/.vendor/mathjs.cjs (sandboxes without node_modules).
// If neither is available the tests skip rather than fail.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createMathEngine } from "../src/mathjsEngine.js";

let math = null;
try {
  const m = await import("mathjs");
  math = m && m.evaluate ? m : m && m.default ? m.default : null;
} catch {
  /* not installed — try the vendored bundle */
}
if (!math) {
  try {
    const require = createRequire(import.meta.url);
    math = require("./.vendor/mathjs.cjs");
  } catch {
    /* unavailable — tests below will skip */
  }
}
const SKIP = math ? false : "math.js unavailable (no node_modules and no test/.vendor bundle)";
const E = math ? createMathEngine(math) : null;

// Core arithmetic / function coverage: expression → expected value.
const EXPECTED = {
  "2*3": 6, "1+2*3": 7, "(1+2)*3": 9, "2^10": 1024, "7/2": 3.5, "2(3)": 6,
  "sqrt(9)": 3, "cbrt(27)": 3, "sin(0)": 0, "cos(0)": 1, "ln(e)": 1,
  "log(1000)": 3, "log2(8)": 3, "5!": 120, "abs(-5)": 5, "2pi": 2 * Math.PI,
  "exp(0)": 1, "floor(3.7)": 3,
};

test("evaluates core arithmetic and functions correctly", { skip: SKIP }, () => {
  for (const [expr, want] of Object.entries(EXPECTED)) {
    const got = E.evaluate(expr);
    assert.notEqual(got, null, `${expr} returned null`);
    assert.ok(Math.abs(got - want) <= 1e-9 + 1e-9 * Math.abs(want), `${expr}: got ${got}, want ${want}`);
  }
});

test("normalizes pretty operator glyphs (× ÷ − → * / -)", { skip: SKIP }, () => {
  assert.equal(E.evaluate("2×3"), 6);
  assert.equal(E.evaluate("8÷2"), 4);
  assert.equal(E.evaluate("5−3"), 2); // U+2212 minus
});

test("fraction/reciprocal toExpr strings evaluate correctly", { skip: SKIP }, () => {
  assert.equal(E.evaluate("((1)/(5))"), 0.2);
  assert.ok(Math.abs(E.evaluate("2+((1)/(3))") - (2 + 1 / 3)) < 1e-12);
  assert.equal(E.evaluate("((12)/(4))"), 3);
});

test("fixes unary-minus precedence (the legacy bug)", { skip: SKIP }, () => {
  assert.equal(E.evaluate("-3+5"), 2);
  assert.equal(E.evaluate("-3-5"), -8);
  assert.equal(E.evaluate("-2+10"), 8);
});

test("ans scope works", { skip: SKIP }, () => {
  assert.equal(E.evaluate("ans+1", { ans: 41 }), 42);
});

test("user variables resolve from scope (Phase 4.5)", { skip: SKIP }, () => {
  assert.equal(E.evaluate("A+1", { A: 5 }), 6);
  assert.equal(E.evaluate("A*B", { A: 3, B: 4 }), 12);
  assert.equal(E.evalRich("M/2", { M: 9 }).display, "4.5");
  assert.equal(E.evaluate("A", {}), null); // undefined var → null, not a silent 0
});

test("% is percent (÷100), not modulo", { skip: SKIP }, () => {
  assert.equal(E.evaluate("50%"), 0.5);
  assert.equal(E.evaluate("5%"), 0.05);
  assert.ok(Math.abs(E.evaluate("200+10%") - 200.1) < 1e-9);
  assert.equal(E.evaluate("100*5%"), 5); // 5% of 100
});

test("multi-argument functions (Phase 4.3)", { skip: SKIP }, () => {
  assert.equal(E.evaluate("gcd(12,8)"), 4);
  assert.equal(E.evaluate("lcm(4,6)"), 12);
  assert.equal(E.evaluate("min(3,1,2)"), 1);
  assert.equal(E.evaluate("max(3,1,2)"), 3);
  assert.equal(E.evaluate("nCr(5,2)"), 10);   // combinations
  assert.equal(E.evaluate("nPr(5,2)"), 20);   // permutations
  assert.equal(E.evaluate("mod(10,3)"), 1);   // true modulo (vs % = percent)
  assert.equal(E.evaluate("logb(8,2)"), 3);   // log base 2 of 8
  assert.equal(E.evaluate("log(1000)"), 3);   // single-arg log still = log10
});

test("statistics functions (Phase 4.7, variadic)", { skip: SKIP }, () => {
  assert.equal(E.evaluate("mean(1,2,3)"), 2);
  assert.equal(E.evaluate("median(1,2,3,4)"), 2.5);
  assert.equal(E.evaluate("std(2,4,6)"), 2);       // sample std (n-1)
  assert.equal(E.evaluate("variance(2,4,6)"), 4);  // sample variance
  assert.equal(E.evaluate("sum(1,2,3,4)"), 10);
});

test("numerical calculus over the app dialect (Phase 4.6)", { skip: SKIP }, () => {
  assert.ok(Math.abs(E.numDerivative("x^2", 3) - 6) < 1e-6);
  assert.ok(Math.abs(E.numDerivative("sin(x)", 0) - 1) < 1e-6);
  assert.ok(Math.abs(E.numIntegral("x^2", 0, 1) - 1 / 3) < 1e-6);
  assert.ok(Math.abs(E.numIntegral("sin(x)", 0, Math.PI) - 2) < 1e-6);
});

test("evaluate() stays real-only (complex → null) for graph/solve callers", { skip: SKIP }, () => {
  assert.equal(E.evaluate("sqrt(-4)"), null); // the real-only path; evalRich surfaces complex
});

// ─── evalRich: display-path classification (Phase 4.2) ──────────────────────
test("evalRich surfaces complex results", { skip: SKIP }, () => {
  assert.deepEqual(E.evalRich("sqrt(-4)"), { kind: "complex", value: E.evalRich("sqrt(-4)").value, display: "2i" });
  assert.equal(E.evalRich("2+3i").display, "2 + 3i");
  assert.equal(E.evalRich("3-4i").display, "3 - 4i");
  assert.equal(E.evalRich("i").display, "i");
});

test("evalRich collapses near-real complex to real", { skip: SKIP }, () => {
  assert.equal(E.evalRich("i^2").kind, "real");
  assert.equal(E.evalRich("i^2").value, -1);
  assert.equal(E.evalRich("(2+3i)*(2-3i)").value, 13);
});

test("evalRich classifies real / infinite / undefined / error / empty", { skip: SKIP }, () => {
  assert.deepEqual(E.evalRich("2+3"), { kind: "real", value: 5, display: "5" });
  assert.equal(E.evalRich("1/0").kind, "infinite");
  assert.equal(E.evalRich("1/0").display, "∞");
  assert.equal(E.evalRich("0/0").kind, "undefined");
  assert.equal(E.evalRich("2+").kind, "error");
  assert.equal(E.evalRich("").kind, "empty");
});

test("real result extracted from complex intermediate", { skip: SKIP }, () => {
  assert.equal(E.evaluate("(sqrt(-4))^2"), -4); // (2i)^2 = -4 (im≈0 → real)
});

test("division by zero → Infinity (not a thrown error)", { skip: SKIP }, () => {
  assert.equal(E.evaluate("1/0"), Infinity);
  assert.equal(E.fmt(E.evaluate("1/0")), "∞");
});

test("0/0 → NaN rendered as 'Undefined' (clearer than 'Error')", { skip: SKIP }, () => {
  assert.ok(Number.isNaN(E.evaluate("0/0")));
  assert.equal(E.fmt(E.evaluate("0/0")), "Undefined");
  assert.equal(E.fmt(NaN), "Undefined");
});

test("invalid / incomplete input → null", { skip: SKIP }, () => {
  assert.equal(E.evaluate(""), null);
  assert.equal(E.evaluate("2+"), null);
  assert.equal(E.evaluate("x"), null); // unknown symbol, no scope → null (was 0 in legacy)
});

test("suggest returns the evaluation as the first chip", { skip: SKIP }, () => {
  const s = E.suggest("2+2");
  assert.ok(s.length >= 1);
  assert.equal(s[0].label, "= 4");
  assert.equal(s[0].action, "eval");
});

test("graphPts compiles once and samples correctly", { skip: SKIP }, () => {
  const pts = E.graphPts("x^2", -2, 2, 4);
  assert.equal(pts.length, 5);
  assert.equal(pts[0].x, -2);
  assert.equal(pts[0].y, 4);
  assert.equal(pts[2].x, 0);
  assert.equal(pts[2].y, 0);
  assert.equal(pts[4].y, 4);
});

test("graphPts yields null y for out-of-domain points", { skip: SKIP }, () => {
  const pts = E.graphPts("sqrt(x)", -4, 4, 8); // negative x → complex → null
  assert.equal(pts[0].y, null);
  const last = pts[pts.length - 1];
  assert.ok(last.y !== null && Math.abs(last.y - 2) < 1e-9); // sqrt(4)=2
});

// ─── solver (Phase 2) end-to-end through math.js ────────────────────────────
test("solve: degree-5 polynomial returns all five roots (audit #5)", { skip: SKIP }, () => {
  const r = E.solve("(x-1)(x-2)(x-3)(x-4)(x-5)=0");
  assert.equal(r.kind, "roots");
  assert.equal(r.display, "x = 1, 2, 3, 4, 5");
});

test("solve: x²+1=0 returns complex roots (not empty)", { skip: SKIP }, () => {
  const r = E.solve("x^2+1=0");
  assert.equal(r.kind, "roots");
  assert.equal(r.display, "x = -i, i");
});

test("solve: x³-1=0 returns the real root and two complex", { skip: SKIP }, () => {
  const r = E.solve("x^3-1=0");
  assert.equal(r.kind, "roots");
  assert.equal(r.solutions.length, 3);
  assert.equal(r.solutions[0], "1");
});

test("solve: (x-1)²=0 reports multiplicity", { skip: SKIP }, () => {
  assert.equal(E.solve("(x-1)^2=0").display, "x = 1 (×2)");
});

test("solve: non-polynomial e^x=5 falls back, finds ln 5, discloses the range", { skip: SKIP }, () => {
  const r = E.solve("e^x=5");
  assert.equal(r.kind, "fallback");
  assert.equal(r.solutions.length, 1);
  assert.ok(Math.abs(parseFloat(r.solutions[0]) - Math.log(5)) < 1e-6);
  assert.match(r.display, /searched \[-100, 100\]/); // bounded-range caveat is visible
});

test("solve: cos(x)=0 is reported as infinitely many (not scattered values)", { skip: SKIP }, () => {
  const r = E.solve("cos(x)=0");
  assert.equal(r.kind, "fallback");
  assert.match(r.display, /infinitely many: periodic/);
  assert.ok(r.solutions.length > 20); // many roots across [-100, 100]
});

test("solve: identity 2x=2x → all real numbers", { skip: SKIP }, () => {
  assert.equal(E.solve("2x=2x").kind, "all");
});
