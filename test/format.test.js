// Number formatting options, degree mode and the nCr/nPr guard — run against
// the app's own curated math.js instance (src/mathInstance.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { math, mathFrac } from "../src/mathInstance.js";
import { createMathEngine } from "../src/mathjsEngine.js";

const E = createMathEngine(math, mathFrac);
const withFormat = (opts, fn) => { E.setFormat(opts); try { fn(); } finally { E.setFormat({ digits: 12, notation: "auto", grouping: true }); } };

test("default format: grouped, 12 significant digits, scientific when tiny/huge", () => {
  assert.equal(E.fmt(1234567), "1,234,567");
  assert.equal(E.fmt(1234.5678), "1,234.5678");
  assert.equal(E.fmt(-1234.5), "-1,234.5");
  assert.equal(E.fmt(0.1 + 0.2), "0.3");
  assert.equal(E.fmt(Math.PI), "3.14159265359");
  assert.equal(E.fmt(0.000015), "1.5e-5");
  assert.equal(E.fmt(2.5e20), "2.5e20");
  assert.equal(E.fmt(0), "0");
});

test("digits, grouping and notation options", () => {
  withFormat({ digits: 6 }, () => assert.equal(E.fmt(Math.PI), "3.14159"));
  withFormat({ grouping: false }, () => {
    assert.equal(E.fmt(1234567), "1234567");
    assert.equal(E.fmt(1234.5), "1234.5");
  });
  withFormat({ notation: "sci" }, () => {
    assert.equal(E.fmt(1234), "1.234e3");
    assert.equal(E.fmt(-0.5), "-5e-1");
  });
  withFormat({ notation: "eng" }, () => {
    assert.equal(E.fmt(12345), "12.345e3");
    assert.equal(E.fmt(0.00123), "1.23e-3");
    assert.equal(E.fmt(42), "42");
  });
  withFormat({ notation: "eng", digits: 6 }, () => assert.equal(E.fmt(999999.9), "1e6")); // rounds up a group
});

test("degree mode: trig in degrees, exact on the axes, inverse returns degrees", () => {
  E.setAngle("deg");
  try {
    assert.equal(E.getAngle(), "deg");
    assert.equal(E.evaluate("sin(90)"), 1);
    assert.equal(E.evaluate("sin(180)"), 0); // not 1.2e-16
    assert.equal(E.evaluate("cos(90)"), 0);
    assert.equal(E.evalRich("tan(90)").kind, "undefined");
    assert.equal(E.evaluate("asin(1)"), 90);
    assert.equal(E.fmt(E.evaluate("sin(30)")), "0.5");
    assert.equal(E.fmt(E.evaluate("cos(-120)")), "-0.5");
    assert.equal(E.compileFn("sin(x)")({ x: 90 }), 1); // graphs & solving follow the mode
    assert.equal(E.exactFraction("sin(30)"), null);   // no bogus exact fraction
  } finally {
    E.setAngle("rad");
  }
  assert.ok(Math.abs(E.evaluate("sin(pi/2)") - 1) < 1e-12);
  assert.equal(E.getAngle(), "rad");
});

test("nCr / nPr: huge inputs answer ∞ at once instead of freezing", () => {
  const t = Date.now();
  assert.equal(math.evaluate("combinations(1e9, 5e8)"), Infinity);
  assert.equal(math.evaluate("permutations(1e9, 5e8)"), Infinity);
  assert.ok(Date.now() - t < 200);
  assert.equal(math.evaluate("combinations(5, 2)"), 10);
  assert.equal(math.evaluate("combinations(3000, 2)"), 4498500); // small k stays exact
  assert.equal(math.evaluate("permutations(10, 3)"), 720);
  assert.equal(math.evaluate("permutations(5)"), 120); // one-argument form untouched
});
