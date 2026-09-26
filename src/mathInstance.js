// Curated math.js instance: include only the functions Kalculator can actually
// produce (keypad buttons + parser), so the bundler tree-shakes everything else
// (units, simplify, derivative, matrices, BigNumber, statistics, …). The full
// `import * as mathjs` pulls the entire library; this keeps `evaluate` / `compile`
// / `typeOf` fully working for every reachable expression. Injected into
// createMathEngine() in Kalculator.jsx. Verified against the full expression set.
import {
  create,
  evaluateDependencies, compileDependencies, typeOfDependencies,
  addDependencies, subtractDependencies, multiplyDependencies, divideDependencies,
  powDependencies, unaryMinusDependencies, unaryPlusDependencies, factorialDependencies,
  sqrtDependencies, cbrtDependencies, absDependencies, expDependencies,
  logDependencies, log10Dependencies, log2Dependencies,
  sinDependencies, cosDependencies, tanDependencies,
  asinDependencies, acosDependencies, atanDependencies,
  sinhDependencies, coshDependencies, tanhDependencies,
  cotDependencies, secDependencies, cothDependencies, sechDependencies,
  acotDependencies, asecDependencies,
  asinhDependencies, acoshDependencies, atanhDependencies, acothDependencies, asechDependencies,
  ceilDependencies, floorDependencies, roundDependencies,
  complexDependencies, iDependencies, piDependencies, eDependencies,
  fractionDependencies,
  gcdDependencies, lcmDependencies, minDependencies, maxDependencies,
  combinationsDependencies, permutationsDependencies, modDependencies,
  meanDependencies, medianDependencies, stdDependencies, varianceDependencies, sumDependencies, modeDependencies,
} from "mathjs";

export const math = create(
  {
    ...evaluateDependencies, ...compileDependencies, ...typeOfDependencies,
    ...addDependencies, ...subtractDependencies, ...multiplyDependencies, ...divideDependencies,
    ...powDependencies, ...unaryMinusDependencies, ...unaryPlusDependencies, ...factorialDependencies,
    ...sqrtDependencies, ...cbrtDependencies, ...absDependencies, ...expDependencies,
    ...logDependencies, ...log10Dependencies, ...log2Dependencies,
    ...sinDependencies, ...cosDependencies, ...tanDependencies,
    ...asinDependencies, ...acosDependencies, ...atanDependencies,
    ...sinhDependencies, ...coshDependencies, ...tanhDependencies,
    ...cotDependencies, ...secDependencies, ...cothDependencies, ...sechDependencies,
    ...acotDependencies, ...asecDependencies,
    ...asinhDependencies, ...acoshDependencies, ...atanhDependencies, ...acothDependencies, ...asechDependencies,
    ...ceilDependencies, ...floorDependencies, ...roundDependencies,
    ...complexDependencies, ...iDependencies, ...piDependencies, ...eDependencies,
    ...gcdDependencies, ...lcmDependencies, ...minDependencies, ...maxDependencies,
    ...combinationsDependencies, ...permutationsDependencies, ...modDependencies,
    ...meanDependencies, ...medianDependencies, ...stdDependencies, ...varianceDependencies, ...sumDependencies, ...modeDependencies,
  },
  { number: "number" },
);

// nCr / nPr loop k times inside math.js, so nCr(10^9, 5·10^8) froze the page
// for ~10 s (and the live result recomputes on every key). Past these bounds
// the true value exceeds the largest double anyway, so answer ∞ at once:
//   C(n,k) ≥ 2^min(k, n−k) > 1.8e308 once min(k, n−k) > 1030;
//   P(n,k) ≥ k! > 1.8e308 once k ≥ 171.
// Anything unusual (non-integers, k > n, complex …) still goes to math.js.
const combinations = math.combinations;
const permutations = math.permutations;
const bigCount = (n, k) => typeof n === "number" && typeof k === "number" && Number.isInteger(n) && Number.isInteger(k) && k >= 0 && k <= n;
math.import({
  combinations: (...a) => (a.length === 2 && bigCount(...a) && Math.min(a[1], a[0] - a[1]) > 1030 ? Infinity : combinations(...a)),
  permutations: (...a) => (a.length === 2 && bigCount(...a) && a[1] >= 171 ? Infinity : permutations(...a)),
}, { override: true });

// Minimal Fraction-mode instance for EXACT rational results (1/3+1/6 → 1/2,
// 0.1+0.2 → 3/10). Only rational operators are registered — expressions with
// irrational functions (sqrt(2), sin, pi, …) throw here, which the engine
// catches and falls back to the decimal value. Used only by exactFraction().
export const mathFrac = create(
  {
    ...evaluateDependencies, ...typeOfDependencies, ...fractionDependencies,
    ...addDependencies, ...subtractDependencies, ...multiplyDependencies, ...divideDependencies,
    ...powDependencies, ...unaryMinusDependencies, ...unaryPlusDependencies,
  },
  { number: "Fraction" },
);
