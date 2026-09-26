// Tests for documents & pages (src/docs.js): file round trip, sanitising of
// untrusted input, migration of the old history, naming.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkSeq, toExpr } from "../src/mathAst.js";
import { parseText } from "../src/mathParse.js";
import {
  MAX_PAGES, newDoc, newPage, isFresh, lastValue, toFile, parseFile, sanitizeDoc,
  docFromHistory, uniqueName, cleanName, fileNameFor,
} from "../src/docs.js";

function pageWith(text, out) {
  const p = newPage("calc");
  p.tree = mkSeq(parseText(text));
  if (out) p.out = { expr: toExpr(p.tree), mode: "calc", type: "calc", ...out };
  return p;
}

test("file round trip keeps pages, structure, results and variables", () => {
  const d = newDoc("Physics");
  d.pages = [pageWith("(1+2)/3", { result: "1", value: 1 }), pageWith("2^10", { result: "1,024", value: 1024 }), newPage()];
  d.vars = { A: 2.5, B: NaN };
  const { doc, notes } = parseFile(toFile(d));
  assert.equal(notes.length, 0);
  assert.equal(doc.id, d.id);
  assert.equal(doc.name, "Physics");
  assert.equal(doc.pages.length, 2); // blank pages are not written
  assert.equal(toExpr(doc.pages[0].tree), "((1+2)/(3))");
  assert.equal(toExpr(doc.pages[1].tree), "2^(10)");
  assert.ok(isFresh(doc.pages[1]));
  assert.deepEqual(doc.vars, { A: 2.5 });
  assert.equal(lastValue(doc), 1024);
});

test("a page without a tree is rebuilt from its readable text", () => {
  const file = JSON.stringify({ format: "kalculator-document", version: 1, name: "t", pages: [{ mode: "calc", text: "√2/2" }] });
  const { doc } = parseFile(file);
  assert.equal(toExpr(doc.pages[0].tree), "((sqrt(2))/(2))");
});

test("non-documents are rejected with a readable message", () => {
  assert.throws(() => parseFile("not json"), /isn't a Kalculator document/);
  assert.throws(() => parseFile("{}"), /isn't a Kalculator document/);
  assert.throws(() => parseFile(JSON.stringify({ format: "other", pages: [] })), /isn't a Kalculator document/);
});

test("untrusted content is sanitised: bad nodes dropped, sizes capped", () => {
  const evil = {
    format: "kalculator-document", version: 99, id: "../../x", name: "\u0000" + "n".repeat(500),
    pages: Array.from({ length: MAX_PAGES + 50 }, () => ({
      mode: "rm -rf",
      tree: { type: "seq", children: [
        { type: "char", value: "<script>" }, { type: "char", value: "7" },
        { type: "func", name: "constructor.prototype", arg: { type: "seq", children: [] } },
        { type: "weird" }, null, 5,
      ] },
      out: { result: 42, expr: "x" },
    })),
  };
  const { doc, notes } = parseFile(JSON.stringify(evil));
  assert.equal(doc.pages.length, MAX_PAGES);
  assert.equal(notes.length, 2); // newer version + truncated
  assert.notEqual(doc.id, "../../x");
  assert.ok(doc.name.length <= 60 && !doc.name.includes("\u0000"));
  assert.equal(doc.pages[0].mode, "calc");
  assert.equal(toExpr(doc.pages[0].tree), "7");
  assert.equal(doc.pages[0].out, null); // result must be a string
});

test("sanitizeDoc survives junk", () => {
  for (const junk of [null, 1, "x", {}, { pages: "no" }]) assert.equal(sanitizeDoc(junk), null);
  const d = sanitizeDoc({ pages: [] });
  assert.equal(d.pages.length, 1);
});

test("old history migrates into a document, one page per entry", () => {
  const entries = [
    { expr: "((1)/(2))", result: "0.5", fraction: "1/2", type: "calc" },
    { expr: "x^(2)-4", result: "x = -2, 2", solutions: ["-2", "2"], type: "solve" },
    { expr: "STO → A", result: "5", type: "calc" },
    { expr: "", result: "", type: "calc" },
  ];
  const d = docFromHistory(entries);
  assert.equal(d.name, "History");
  assert.equal(d.pages.length, 3); // two entries + a fresh blank page to type on
  assert.equal(toExpr(d.pages[0].tree), "((1)/(2))");
  assert.equal(d.pages[0].out.fraction, "1/2");
  assert.equal(d.pages[1].mode, "solve");
  assert.deepEqual(d.pages[1].out.solutions, ["-2", "2"]);
  assert.ok(isFresh(d.pages[0]));
  assert.equal(d.current, 2);
  assert.equal(lastValue(d), 0.5);
});

test("naming helpers", () => {
  assert.equal(uniqueName("Untitled", ["Untitled", "Untitled 2"]), "Untitled 3");
  assert.equal(uniqueName("Notes", ["Untitled"]), "Notes");
  assert.equal(cleanName("   "), "Untitled");
  assert.equal(fileNameFor('a/b:c*"d'), "a-b-c-d.kalc");
});
