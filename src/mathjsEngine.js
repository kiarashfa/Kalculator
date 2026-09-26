// ─── math.js-backed engine (hybrid) ─────────────────────────────────────────
// Same surface as the legacy MathEngine (evaluate / fmt / suggest / solve /
// graphPts) but evaluation/solving run on math.js. math.js is *injected* rather
// than imported here so this module stays importable in test sandboxes without
// node_modules — the app passes the real `mathjs`, tests pass a vendored bundle.
import { toMathjs } from "./mathAst.js";
import { extractPolyCoeffs, solvePolyCoeffs, formatRoot, bracketRoots, looksPeriodic } from "./polysolve.js";
import { derivative as numDerivative_, integrate as numIntegrate_ } from "./calculus.js";

export function createMathEngine(math, mathFrac) {
  // math.js results can be number / Complex / Fraction / BigNumber / … — reduce
  // to a plain JS number, or null when not (yet) representable as a real result.
  function coerceReal(r) {
    if (r === null || r === undefined) return null;
    const t = math.typeOf(r);
    if (t === "number") return r; // NaN (indeterminate, e.g. 0/0) and ±Infinity pass through
    if (t === "BigNumber" || t === "Fraction") {
      const n = typeof r.toNumber === "function" ? r.toNumber() : Number(r);
      return Number.isNaN(n) ? null : n;
    }
    if (t === "Complex") return Math.abs(r.im) < 1e-12 ? r.re : null; // genuine complex → Phase 4.2
    return null; // Unit, Matrix, boolean, … — not representable yet
  }

  // ── Angle mode ──
  // In degree mode the trig functions travel in the evaluation scope, which
  // math.js consults before its own functions — so every path (results,
  // graphs, solving, calculus) follows the mode. Multiples of 90° are exact:
  // sin 180° = 0 and tan 90° is undefined, rather than 1.2e-16 / 1.6e16.
  const D2R = Math.PI / 180;
  const toRad = (x) => (typeof x === "number" ? x * D2R : math.multiply(x, D2R));
  const toDeg = (r) => (typeof r === "number" ? r / D2R : math.multiply(r, 1 / D2R));
  const quarter = (x) => (typeof x === "number" && Number.isFinite(x) && x % 90 === 0 ? (((x / 90) % 4) + 4) % 4 : -1);
  const exact = (table, fn) => (x) => { const q = quarter(x); return q >= 0 ? table[q] : fn(toRad(x)); };
  const DEGREE_FNS = {
    sin: exact([0, 1, 0, -1], math.sin),
    cos: exact([1, 0, -1, 0], math.cos),
    tan: exact([0, NaN, 0, NaN], math.tan),
    cot: exact([NaN, 0, NaN, 0], math.cot),
    sec: exact([1, NaN, -1, NaN], math.sec),
    asin: (x) => toDeg(math.asin(x)),
    acos: (x) => toDeg(math.acos(x)),
    atan: (x) => toDeg(math.atan(x)),
    acot: (x) => toDeg(math.acot(x)),
    asec: (x) => toDeg(math.asec(x)),
  };
  let angleFns = null; // null = radians (math.js default)
  function setAngle(mode) { angleFns = mode === "deg" ? DEGREE_FNS : null; }
  const getAngle = () => (angleFns ? "deg" : "rad");
  const withAngle = (scope) => (angleFns ? { ...scope, ...angleFns } : scope);

  function scopeFrom(vars) {
    // Pass through any provided scope variables (x, ans, and user vars A/B/C/…),
    // dropping undefined/null; `ans` defaults to 0.
    const s = {};
    if (vars) for (const k in vars) { const v = vars[k]; if (v !== undefined && v !== null) s[k] = v; }
    if (s.ans === undefined) s.ans = 0;
    return withAngle(s);
  }

  function evaluate(expr, vars = {}) {
    const src = toMathjs(expr);
    if (!src.trim()) return null;
    try {
      return coerceReal(math.evaluate(src, scopeFrom(vars)));
    } catch {
      return null;
    }
  }

  // Rich evaluation for the display path: classifies the result so the UI can
  // render reals, complex numbers, ∞, and Undefined distinctly. (The plain
  // `evaluate` above stays real-only — it feeds graphing/solving/suggestions.)
  // Returns { kind, value?, display? } with kind ∈
  //   "real" | "complex" | "infinite" | "undefined" | "empty" | "error".
  function evalRich(expr, vars = {}) {
    const src = toMathjs(expr);
    if (!src.trim()) return { kind: "empty" };
    let r;
    try {
      r = math.evaluate(src, scopeFrom(vars));
    } catch {
      return { kind: "error" };
    }
    const t = math.typeOf(r);
    if (t === "Complex") {
      if (Math.abs(r.im) < 1e-12) r = r.re; // collapse to real
      else return { kind: "complex", value: r, display: formatRoot({ re: r.re, im: r.im, mult: 1 }) };
    }
    if (t === "BigNumber" || t === "Fraction") r = typeof r.toNumber === "function" ? r.toNumber() : Number(r);
    if (typeof r === "number") {
      if (Number.isNaN(r)) return { kind: "undefined", display: "Undefined" };
      if (!isFinite(r)) return { kind: "infinite", value: r, display: r > 0 ? "∞" : "-∞" };
      return { kind: "real", value: r, display: fmt(r) };
    }
    if (t === "Array" || t === "Matrix") {
      // Some functions (e.g. mode) return a set of values → show them comma-joined.
      const arr = t === "Matrix" ? r.toArray() : r;
      const nums = arr.map(coerceReal).filter((v) => v !== null);
      if (nums.length) return { kind: "real", value: nums[0], multi: nums.length > 1, display: nums.map(fmt).join(", ") };
    }
    return { kind: "error" };
  }

  // Compile once, evaluate many — for hot loops (graphing, root-finding).
  function compileFn(expr) {
    let node;
    try {
      node = math.compile(toMathjs(expr));
    } catch {
      return () => null;
    }
    return (scope) => {
      try {
        return coerceReal(node.evaluate(withAngle(scope)));
      } catch {
        return null;
      }
    };
  }

  // Exact rational form of an expression, e.g. "1/3+1/6" → "1/2", "0.1+0.2" →
  // "3/10". Returns null when the result isn't a non-integer fraction or the
  // expression is irrational (sqrt(2), pi, sin, … → mathFrac throws). Lets the
  // UI show the exact fraction with a toggle to the decimal value.
  function exactFraction(expr, vars = {}) {
    if (!mathFrac) return null;
    let r;
    try {
      r = mathFrac.evaluate(toMathjs(expr), scopeFrom(vars));
    } catch {
      return null; // irrational / unsupported in Fraction mode → decimal only
    }
    if (mathFrac.typeOf(r) !== "Fraction") return null;
    const d = Number(r.d);
    if (!Number.isFinite(d) || d === 1 || d > 1e9) return null; // whole number or unwieldy
    return r.toFraction(); // "n/d" (sign included)
  }

  // ── Number formatting ──
  // digits: significant digits (6/10/12/15) · notation: "auto" (plain, with
  // whole numbers in full and tiny/huge values scientific), "sci" or "eng"
  // (exponent a multiple of 3) · grouping: 1,234,567 separators.
  let FORMAT = { digits: 12, notation: "auto", grouping: true };
  function setFormat(opts) { FORMAT = { ...FORMAT, ...opts }; }
  const group = (s) => {
    if (!FORMAT.grouping) return s;
    const [int, frac] = s.split(".");
    const sign = int.startsWith("-") ? "-" : "";
    const body = sign ? int.slice(1) : int;
    return sign + body.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (frac !== undefined ? "." + frac : "");
  };
  const trim = (m) => (m.includes(".") ? m.replace(/0+$/, "").replace(/\.$/, "") : m);
  const plain = (n, digits) => {
    const s = String(parseFloat(n.toPrecision(digits)));
    return /e/i.test(s) ? sci(n, digits) : group(s);
  };
  function sci(n, digits) {
    const [m, e] = n.toExponential(Math.max(0, digits - 1)).split("e");
    return `${trim(m)}e${Number(e)}`;
  }
  function eng(n, digits) {
    let e = Math.floor(Math.log10(Math.abs(n)) / 3) * 3;
    let m = parseFloat((n / 10 ** e).toPrecision(digits));
    if (Math.abs(m) >= 1000) { m /= 1000; e += 3; } // 999.9995 rounded up
    const ms = group(trim(String(parseFloat(m.toPrecision(digits)))));
    return e === 0 ? ms : `${ms}e${e}`;
  }
  function fmt(n) {
    if (n === null || n === undefined) return "Error";
    if (Number.isNaN(n)) return "Undefined"; // e.g. 0/0, ∞−∞: clearer than "Error"
    if (!isFinite(n)) return n > 0 ? "∞" : "-∞";
    if (n === 0) return "0";
    const abs = Math.abs(n), d = FORMAT.digits;
    if (FORMAT.notation === "sci") return sci(n, d);
    if (FORMAT.notation === "eng") return eng(n, d);
    if (Number.isInteger(n) && abs < 1e15) return group(String(n));
    if (abs < 1e-4 || abs >= 1e12) return sci(n, d);
    return plain(n, d);
  }

  function suggest(expr) {
    if (!expr || expr.length < 1) return [];
    const sg = [];
    const r = evaluate(expr);
    const finite = r !== null && isFinite(r);
    if (finite) sg.push({ label: `= ${fmt(r)}`, action: "eval", p: 0 });
    const fns = ["sin", "cos", "tan", "sqrt", "log", "ln", "abs"];
    if (finite)
      for (const fn of fns) {
        const fr = evaluate(`${fn}(${expr})`);
        if (fr !== null && isFinite(fr)) sg.push({ label: `${fn}(…) = ${fmt(fr)}`, action: `${fn}(${expr})`, p: 2 });
      }
    return sg.sort((a, b) => a.p - b.p).slice(0, 5);
  }

  // Solve f(x) = g(x). Returns { kind, display, solutions } where kind is
  // "roots" | "all" | "none" | "fallback". Genuine polynomials in x are solved
  // exactly (all roots incl. complex + multiplicity); everything else uses a
  // bounded sign-change search whose window is always disclosed in the display.
  const SOLVE_RANGE = { xMin: -100, xMax: 100 };
  function solve(expr) {
    const parts = expr.split("=");
    const fe = parts.length === 2 ? `(${parts[0].trim()})-(${parts[1].trim()})` : expr;
    const f = compileFn(fe);
    const sample = (x) => {
      const y = f({ x, ans: 0 });
      return y === null ? null : y;
    };

    // Polynomial path
    const coeffs = extractPolyCoeffs(sample);
    if (coeffs) {
      const res = solvePolyCoeffs(coeffs);
      if (res.kind === "all") return { kind: "all", display: "All real numbers are solutions", solutions: [] };
      if (res.kind === "none" || res.roots.length === 0) return { kind: "none", display: "No solution", solutions: [] };
      const strs = res.roots.map(formatRoot);
      return { kind: "roots", display: `x = ${strs.join(", ")}`, solutions: strs };
    }

    // Fallback: non-polynomial → bounded sign-change search (range disclosed).
    const { xMin, xMax } = SOLVE_RANGE;
    const range = `[${xMin}, ${xMax}]`;
    const roots = bracketRoots(sample, SOLVE_RANGE);
    if (!roots.length) return { kind: "none", display: `No solution found in ${range}`, solutions: [] };
    const strs = roots.map((r) => formatRoot({ re: r, im: 0, mult: 1 }));

    if (looksPeriodic(roots)) {
      // periodic / infinite set — show the few solutions nearest 0 as samples
      const reps = roots
        .slice().sort((a, b) => Math.abs(a) - Math.abs(b)).slice(0, 4).sort((a, b) => a - b)
        .map((r) => formatRoot({ re: r, im: 0, mult: 1 })).join(", ");
      return { kind: "fallback", display: `x ≈ ${reps}, … (infinitely many: periodic)`, solutions: strs };
    }
    if (roots.length > 10) {
      return { kind: "fallback", display: `x ≈ ${strs.slice(0, 10).join(", ")}, … (${strs.length} found in ${range})`, solutions: strs };
    }
    return { kind: "fallback", display: `x ≈ ${strs.join(", ")}  ·  searched ${range}`, solutions: strs };
  }

  // Numerical calculus over f(x): derivative at a point, definite integral.
  function numDerivative(expr, a) {
    const f = compileFn(expr);
    return numDerivative_((x) => f({ x, ans: 0 }), a);
  }
  function numIntegral(expr, a, b) {
    const f = compileFn(expr);
    return numIntegrate_((x) => f({ x, ans: 0 }), a, b);
  }

  function graphPts(expr, xMin = -10, xMax = 10, steps = 400) {
    const f = compileFn(expr);
    const pts = [], dx = (xMax - xMin) / steps;
    for (let i = 0; i <= steps; i++) {
      const x = xMin + i * dx;
      const y = f({ x, ans: 0 });
      pts.push({ x, y: y !== null && isFinite(y) ? y : null });
    }
    return pts;
  }

  return { evaluate, evalRich, compileFn, fmt, setFormat, setAngle, getAngle, suggest, solve, graphPts, exactFraction, numDerivative, numIntegral };
}
