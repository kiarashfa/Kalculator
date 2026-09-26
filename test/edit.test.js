// Node-native tests for the caret/editing engine (src/mathEdit.js). Each test
// "types" through the same ops the UI calls and checks the resulting toExpr()
// string (and, where it matters, the caret) — no React/DOM involved.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkSeq, toExpr, findSeq, cloneTree } from "../src/mathAst.js";
import {
  insertChar, typeChar, insertStruct, insertExponent, insertReciprocal, openParen, closeParen,
  moveLeft, moveRight, moveUp, moveDown, moveHome, moveEnd, exitRight,
  backspace, deleteForward, insertText, wrapAll, enclosingNode,
} from "../src/mathEdit.js";

const FUNCS = ["sin", "cos", "tan", "asin", "ln", "log", "log2", "abs", "exp", "cbrt"];

// A tiny "editor": applies a script of keys, returns { root, cur, expr }.
function run(keys, root = mkSeq(), cur = { seqId: root.id, pos: 0 }) {
  for (const k of keys) {
    if (k === "/") cur = insertStruct(root, cur, "frac");
    else if (k === "^") cur = insertExponent(root, cur, null);
    else if (k === "sq") cur = insertExponent(root, cur, "2");
    else if (k === "1/x") cur = insertReciprocal(root, cur);
    else if (k === "√") cur = insertStruct(root, cur, "sqrt");
    else if (k === "(") cur = openParen(root, cur, FUNCS);
    else if (k === ")") cur = closeParen(root, cur);
    else if (k === "←") cur = moveLeft(root, cur);
    else if (k === "→") cur = moveRight(root, cur);
    else if (k === "↑") cur = moveUp(root, cur) ?? cur;
    else if (k === "↓") cur = moveDown(root, cur) ?? cur;
    else if (k === "Home") cur = moveHome(root, cur);
    else if (k === "End") cur = moveEnd(root, cur);
    else if (k === "Tab") cur = exitRight(root, cur);
    else if (k === "⌫") cur = backspace(root, cur);
    else if (k === "Del") cur = deleteForward(root, cur);
    else if (k.length > 1 && FUNCS.includes(k)) cur = insertStruct(root, cur, "func", k);
    else cur = typeChar(root, cur, k);
  }
  return { root, cur, expr: toExpr(root) };
}
const keys = (s) => [...s];

// ─── Exponents (attach to the preceding node) ───────────────────────────────
test("x^2+1: + leaves a non-empty exponent", () => {
  assert.equal(run(["x", "^", "2", "+", "1"]).expr, "x^(2)+1");
});

test("e^-x: − stays in an empty exponent", () => {
  assert.equal(run(["e", "^", "-", "x"]).expr, "e^(-x)");
});

test("x² on a power wraps it: x³ then x² → (x³)²", () => {
  const r = run(["x", "^", "3", "→", "sq"]);
  assert.equal(r.expr, "(x^(3))^(2)");
});

test("^ right after an exponent re-enters it instead of stacking", () => {
  assert.equal(run(["2", "^", "3", "→", "^", "4"]).expr, "2^(34)");
});

test("^ with nothing to raise opens an empty ( ) base", () => {
  const r = run(["^"]);
  assert.equal(r.expr, "()^()");
  // → leaves the ( ), a second → enters the exponent
  assert.equal(run(["^", "3", "→", "→", "2"]).expr, "(3)^(2)");
});

test("the √ after 5² goes beside it, not inside the exponent (→ leaves it)", () => {
  assert.equal(run(["5", "^", "2", "→", "√", "3"]).expr, "5^(2)sqrt(3)");
});

// ─── Fractions & ) ──────────────────────────────────────────────────────────
test("sin(1/2) types linearly: ) closes the function from inside the fraction", () => {
  assert.equal(run(["sin", "1", "/", "2", ")", "+", "1"]).expr, "sin(((1)/(2)))+1");
});

test("(a+b)/ drops the now-redundant parentheses: the bar groups", () => {
  assert.equal(run(["(", "1", "+", "2", ")", "/", "3"]).expr, "((1+2)/(3))");
  assert.equal(run(["(", "1", "+", "2", ")", "1/x"]).expr, "((1)/(1+2))");
});

test("a number right after a structure multiplies explicitly (2³4 → 2^(3)*4)", () => {
  assert.equal(run(["2", "^", "3", "→", "4"]).expr, "2^(3)*4");
});

test(") with no ( ) around leaves the innermost structure", () => {
  assert.equal(run(["3", "/", "4", ")", "+", "1"]).expr, "((3)/(4))+1");
});

test("typed function names become functions at (", () => {
  assert.equal(run([...keys("2sin("), "x", ")"]).expr, "2sin(x)");
  assert.equal(run([...keys("asin("), "1", ")"]).expr, "asin(1)"); // longest name wins
  assert.equal(run([...keys("log2("), "8", ")"]).expr, "log2(8)");
  assert.equal(run([...keys("sqrt("), "9", ")"]).expr, "sqrt(9)");
  assert.equal(run([...keys("(1+2)")]).expr, "(1+2)");
});

test("pi → π", () => {
  assert.equal(run(keys("2pi")).expr, "2π");
});

// ─── Navigation ─────────────────────────────────────────────────────────────
test("← then typing inserts before the last char", () => {
  assert.equal(run(["1", "2", "←", "5"]).expr, "152");
});

test("← walks into a fraction's denominator, then numerator", () => {
  // 3/4| ← → 3/4 caret at end of den; ← ← → start of den → end of num
  assert.equal(run(["3", "/", "4", "Tab", "←", "←", "←", "7"]).expr, "((37)/(4))");
});

test("→ from the start walks into a fraction's numerator", () => {
  assert.equal(run(["3", "/", "4", "Home", "Home", "→", "5"]).expr, "((53)/(4))");
});

test("↑/↓ move between numerator and denominator", () => {
  assert.equal(run(["3", "/", "4", "↑", "1"]).expr, "((31)/(4))");
  assert.equal(run(["3", "/", "4", "↑", "↓", "0"]).expr, "((3)/(40))");
});

test("↓ leaves an exponent", () => {
  assert.equal(run(["2", "^", "3", "↓", "+", "1"]).expr, "2^(3)+1");
});

test("Home/End go to the slot edge, then the expression edge", () => {
  assert.equal(run(["1", "+", "2", "/", "3", "Home", "9"]).expr, "1+((2)/(93))");
  assert.equal(run(["1", "+", "2", "/", "3", "Home", "Home", "9"]).expr, "91+((2)/(3))");
  assert.equal(run(["1", "2", "Home", "End", "9"]).expr, "129");
});

test("← at the very start and → at the very end are no-ops", () => {
  assert.equal(run(["1", "Home", "Home", "←", "2"]).expr, "21");
  assert.equal(run(["1", "→", "2"]).expr, "12");
});

// ─── Deletion ───────────────────────────────────────────────────────────────
test("⌫ after a fraction steps into it instead of flattening (old bug: 3/4 → 34)", () => {
  const r = run(["3", "/", "4", "Tab", "⌫"]);
  assert.equal(r.expr, "((3)/(4))");
  assert.equal(run(["3", "/", "4", "Tab", "⌫", "⌫"]).expr, "((3)/())");
});

test("⌫ in an empty denominator removes the fraction, keeps the numerator", () => {
  assert.equal(run(["1", "+", "3", "/", "⌫", "5"]).expr, "1+35");
});

test("⌫ at the start of a function argument unwraps it: sin(9) → 9", () => {
  assert.equal(run(["sin", "9", "←", "⌫"]).expr, "9");
});

test("⌫ deletes an empty structure outright", () => {
  assert.equal(run(["2", "√", "⌫"]).expr, "2");
  assert.equal(run(["2", "√", "→", "⌫"]).expr, "2");
});

test("Delete removes the char after the caret and steps into structures", () => {
  assert.equal(run(["1", "2", "3", "←", "←", "Del"]).expr, "13");
  assert.equal(run(["1", "√", "4", "Home", "Home", "→", "Del"]).expr, "1sqrt(4)");
});

// ─── Misc ───────────────────────────────────────────────────────────────────
test("1/x takes a whole power as the denominator: 2³ → 1/2³", () => {
  assert.equal(run(["2", "^", "3", "→", "1/x"]).expr, "((1)/(2^(3)))");
});

test("paste parses text back into structure (glyphs normalised)", () => {
  const root = mkSeq();
  insertText(root, { seqId: root.id, pos: 0 }, "2 ÷ 3 + 1 × 4 − 1");
  assert.equal(toExpr(root), "((2)/(3))+1*4-1");
});

test("wrapAll wraps the whole expression in a function", () => {
  const { root } = run(["1", "+", "2"]);
  wrapAll(root, "sin");
  assert.equal(toExpr(root), "sin(1+2)");
});

test("enclosingNode finds the sub-expression around the caret", () => {
  const { root, cur } = run(["2", "+", "ln", "5"]);
  assert.equal(toExpr(enclosingNode(root, cur)), "ln(5)");
  assert.equal(enclosingNode(...(() => { const r = run(["1"]); return [r.root, r.cur]; })()), null);
});

test("cloneTree deep-copies with fresh ids", () => {
  const { root } = run(["1", "/", "2"]);
  const c = cloneTree(root);
  assert.equal(toExpr(c), toExpr(root));
  assert.notEqual(c.id, root.id);
  assert.notEqual(c.children[0].num.id, root.children[0].num.id);
  assert.equal(findSeq(c, root.children[0].num.id), null);
});
