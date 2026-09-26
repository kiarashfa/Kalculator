// Tests for the clipboard parser (src/mathParse.js) and the text/LaTeX
// serializers it pairs with. The key property: copy (toText) → paste
// (parseText) reproduces the same expression, so formatting survives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkSeq, toExpr, toText, toLatex, toMathjs } from "../src/mathAst.js";
import { parseText } from "../src/mathParse.js";
import {
  typeChar, insertStruct, insertExponent, openParen, closeParen, moveRight,
} from "../src/mathEdit.js";
import { FUNC_NAMES } from "../src/mathAst.js";

const expr = (text) => toExpr(mkSeq(parseText(text)));

test("powers keep their structure (the 2^3 → 23 bug)", () => {
  assert.equal(expr("2^3"), "2^(3)");
  assert.equal(expr("x^2+1"), "x^(2)+1");
  assert.equal(expr("2^(3+1)"), "2^(3+1)");
  assert.equal(expr("2^-1"), "2^(-1)");
  assert.equal(expr("2^3^2"), "2^(3^(2))"); // right-associative
  assert.equal(expr("x²+y³"), "x^(2)+y^(3)"); // unicode superscripts
  assert.equal(expr("2**8"), "2^(8)");
});

test("fractions: / binds the operands on either side", () => {
  assert.equal(expr("1/2"), "((1)/(2))");
  assert.equal(expr("1+2/3"), "1+((2)/(3))");
  assert.equal(expr("(1+2)/3"), "((1+2)/(3))"); // parens dropped: the bar groups
  assert.equal(expr("1/(2+3)"), "((1)/(2+3))");
  assert.equal(expr("1/2/3"), "((((1)/(2)))/(3))");
  assert.equal(expr("2^3/4"), "((2^(3))/(4))");
  assert.equal(expr("-2/3"), "-((2)/(3))");
  assert.equal(expr("x^(1/2)"), "x^(((1)/(2)))");
});

test("functions, roots, constants", () => {
  assert.equal(expr("sin(x)+cos(2x)"), "sin(x)+cos(2x)");
  assert.equal(expr("sqrt(2)"), "sqrt(2)");
  assert.equal(expr("√(1+2)"), "sqrt(1+2)");
  assert.equal(expr("√2"), "sqrt(2)");
  assert.equal(expr("∛8"), "cbrt(8)");
  assert.equal(expr("log2(8)"), "log2(8)");
  assert.equal(expr("|−3|"), "abs(-3)");
  assert.equal(expr("2π"), "2π");
  assert.equal(expr("2pi"), "2π");
  assert.equal(expr("Ans×2"), "ans*2");
  assert.equal(expr("logb(8,2)"), "logb(8,2)");
  assert.equal(expr("sin x"), "sin(x)");
});

test("text from elsewhere: glyphs, spaces, separators, scientific notation", () => {
  assert.equal(expr("3 × 4 ÷ 2 − 1"), "3*((4)/(2))-1");
  assert.equal(expr("1,025"), "1025");            // a copied result
  assert.equal(expr("1,234,567.5"), "1234567.5");
  assert.equal(expr("gcd(12,345)"), "gcd(12,345)"); // inside a call, a comma separates
  assert.equal(expr("2.5e-7"), "2.5E-7");
  assert.equal(expr("6.02E23"), "6.02E23");
  assert.equal(expr("5!+10%"), "5!+10%");
});

test("garbage never throws and yields a well-formed tree", () => {
  for (const t of ["", ")))", "((((", "/", "^", "√", "|", "2+", "@#$", "sin(", "1//2", "^^2"]) {
    assert.doesNotThrow(() => toExpr(mkSeq(parseText(t))), t);
  }
});

// Build expressions the way a user types them, then copy → paste.
const FUNCS = FUNC_NAMES;
function typed(keys) {
  const root = mkSeq();
  let cur = { seqId: root.id, pos: 0 };
  for (const k of keys) {
    if (k === "/") cur = insertStruct(root, cur, "frac");
    else if (k === "^") cur = insertExponent(root, cur, null);
    else if (k === "√") cur = insertStruct(root, cur, "sqrt");
    else if (k === "(") cur = openParen(root, cur, FUNCS);
    else if (k === ")") cur = closeParen(root, cur);
    else if (k === "→") cur = moveRight(root, cur);
    else cur = typeChar(root, cur, k);
  }
  return root;
}

test("round trip: copy (toText) → paste (parseText) keeps the expression", () => {
  const cases = [
    ["2", "^", "3"],
    ["(", "1", "+", "2", ")", "/", "3"],
    ["1", "/", "2", "→", "+", "1", "/", "3"],
    [..."sin(", "x", ")", "^", "2", "→", "+", "1"],
    ["√", "2", "→", "+", "√", "1", "/", "2"],
    ["2", "π", "-", "e", "^", "-", "x"],
    [..."log2(", "8", ")", "*", "3", "^", "2", "→", "!"],
    ["x", "^", "1", "/", "2"],
  ];
  for (const keys of cases) {
    const original = typed(keys);
    const pasted = mkSeq(parseText(toText(original)));
    assert.equal(toExpr(pasted), toExpr(original), `${toText(original)}`);
  }
});

test("toLatex", () => {
  assert.equal(toLatex(mkSeq(parseText("(1+2)/3"))), "\\frac{1+2}{3}");
  assert.equal(toLatex(mkSeq(parseText("x^2*√(y)"))), "x^{2}\\times \\sqrt{y}");
  assert.equal(toLatex(mkSeq(parseText("sin(π/2)"))), "\\sin\\left(\\frac{\\pi}{2}\\right)");
  assert.equal(toLatex(mkSeq(parseText("nCr(5,2)"))), "\\operatorname{nCr}\\left(5,2\\right)");
});

test("security: identifiers outside the allowlist can't reach math.js", () => {
  assert.match(toMathjs("config(1)"), /@/);
  assert.match(toMathjs("evaluate(2)"), /@/);
  assert.match(toMathjs("import(x)"), /@/);
  assert.equal(toMathjs("sin(x)+log(100)+ln(e)"), "sin(x)+log10(100)+log(e)");
  assert.equal(toMathjs("1.5E3+2e5+A*M"), "1.5E3+2e5+A*M");
});
