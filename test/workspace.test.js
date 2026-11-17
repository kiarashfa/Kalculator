// Tests for the save file and merging (src/workspace.js): round trip, sanitising of
// untrusted input, and what a merge keeps, takes and drops.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkSeq, toExpr } from "../src/mathAst.js";
import { parseText } from "../src/mathParse.js";
import { newDoc, newPage } from "../src/docs.js";
import {
  serializeWorkspace, parseWorkspace, readWorkspace, planMerge, describeMerge, cleanProfile,
  initialsOf, saveFileName, PICTURE_MAX, MAX_REMOVED,
} from "../src/workspace.js";

const PIC = "data:image/webp;base64,UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==";
const docWith = (name, text, updatedAt) => {
  const d = newDoc(name);
  const p = newPage("calc");
  p.tree = mkSeq(parseText(text));
  d.pages = [p];
  d.updatedAt = updatedAt;
  return d;
};
const profile = (name, updatedAt, extra = {}) => cleanProfile({ name, updatedAt, createdAt: updatedAt, ...extra });
const local = (docs = [], removed = [], prof = null) => ({ docs: docs.map((d) => ({ id: d.id, updatedAt: d.updatedAt })), removed, profile: prof });
const incoming = (docs = [], removed = [], prof = null) => ({ docs, removed, profile: prof, current: docs[0]?.id ?? null, notes: [] });

test("a save file round trips documents, profile and deletion records", () => {
  const a = docWith("Physics", "(1+2)/3", 1000);
  const b = docWith("Maths", "2^10", 2000);
  const text = serializeWorkspace({
    docs: [a, b], removed: [{ id: "gone-document-1", at: 5 }], profile: profile("Ada Lovelace", 3000, { picture: PIC, tint: "blue" }), current: b.id,
  });
  const r = parseWorkspace(text);
  assert.ok(r.ok);
  const ws = r.workspace;
  assert.deepEqual(ws.docs.map((d) => d.name), ["Physics", "Maths"]);
  assert.equal(toExpr(ws.docs[0].pages[0].tree), "((1+2)/(3))");
  assert.equal(ws.current, b.id);
  assert.deepEqual(ws.removed, [{ id: "gone-document-1", at: 5 }]);
  assert.equal(ws.profile.name, "Ada Lovelace");
  assert.equal(ws.profile.picture, PIC);
});

test("files that are not save files are refused with a readable reason", () => {
  assert.equal(parseWorkspace("nope").ok, false);
  assert.match(parseWorkspace("{}").error, /isn't a Kalculator save file/);
  assert.match(parseWorkspace(JSON.stringify({ format: "kalculator-save", version: 99, documents: [] })).error, /newer version/);
  assert.match(parseWorkspace(JSON.stringify({ format: "kalculator-save", version: 1 })).error, /damaged/);
  assert.equal(readWorkspace(null).ok, false);
});

test("a damaged document or record is skipped, not fatal", () => {
  const good = docWith("Good", "1+1", 10);
  const r = parseWorkspace(JSON.stringify({
    format: "kalculator-save", version: 1, current: "missing",
    documents: [null, { format: "other" }, JSON.parse(serializeWorkspace({ docs: [good] })).documents[0]],
    removed: [{ id: "x", at: "soon" }, { id: "ok-document-id", at: 7 }, 5],
    profile: "not an object",
  }));
  assert.ok(r.ok);
  assert.equal(r.workspace.docs.length, 1);
  assert.equal(r.workspace.current, good.id);
  assert.deepEqual(r.workspace.removed, [{ id: "ok-document-id", at: 7 }]);
  assert.equal(r.workspace.profile, null);
});

test("duplicate ids in a file keep the newer copy", () => {
  const old = docWith("Old", "1", 100);
  const fresh = { ...docWith("New", "2", 200), id: old.id };
  const r = parseWorkspace(serializeWorkspace({ docs: [old, fresh] }));
  assert.equal(r.workspace.docs.length, 1);
  assert.equal(r.workspace.docs[0].name, "New");
});

test("a profile is sanitised: picture must be a small image data URL, nothing else is kept", () => {
  assert.equal(cleanProfile(null), null);
  assert.equal(cleanProfile({ name: "A", picture: "https://evil.example/x.png" }).picture, null);
  assert.equal(cleanProfile({ name: "A", picture: "data:image/svg+xml;base64,AAAA" }).picture, null);
  assert.equal(cleanProfile({ name: "A", picture: "data:image/webp;base64," + "A".repeat(PICTURE_MAX) }).picture, null);
  assert.equal(cleanProfile({ name: "A", picture: PIC }).picture, PIC);
  const p = cleanProfile({ name: "  Ada\n  Lovelace  ", tint: "pink", letters: "XY", updatedAt: "x" });
  assert.equal(p.name, "Ada Lovelace");
  assert.deepEqual(Object.keys(p).sort(), ["createdAt", "name", "picture", "updatedAt"]);
  assert.equal(cleanProfile({ name: "x".repeat(200) }).name.length, 40);
});

test("initials come from the name: one name one letter, otherwise the first two names", () => {
  assert.equal(initialsOf("Ada"), "A");
  assert.equal(initialsOf("ada"), "A");
  assert.equal(initialsOf("Ada Lovelace"), "AL");
  assert.equal(initialsOf("  ada   king lovelace "), "AK");
  assert.equal(initialsOf("Jean Claude Van Damme"), "JC");
  assert.equal(initialsOf(""), "");
  assert.equal(initialsOf("Émile Zola"), "ÉZ");
});

test("merge: the newer edit of a document wins and new documents come in", () => {
  const a = docWith("A", "1", 100);
  const aNew = { ...docWith("A edited", "2", 200), id: a.id };
  const b = docWith("B", "3", 50);
  const plan = planMerge(local([a]), incoming([aNew, b]));
  assert.deepEqual(plan.take.sort(), [a.id, b.id].sort());
  assert.equal(plan.added, 1);
  assert.equal(plan.updated, 1);
  assert.equal(plan.localAhead, false);
  assert.equal(describeMerge(plan), "1 new document and 1 updated");
});

test("merge: an older incoming copy never overwrites, and the cloud is behind", () => {
  const a = docWith("A", "1", 300);
  const aOld = { ...docWith("A old", "2", 200), id: a.id };
  const plan = planMerge(local([a]), incoming([aOld]));
  assert.deepEqual(plan.take, []);
  assert.equal(plan.localAhead, true);
  assert.equal(describeMerge(plan), "");
});

test("merge: a document deleted after its last edit stays deleted, in either direction", () => {
  const a = docWith("A", "1", 100);
  // deleted on the other device
  let plan = planMerge(local([a]), incoming([], [{ id: a.id, at: 150 }]));
  assert.deepEqual(plan.drop, [a.id]);
  assert.equal(plan.deleted, 1);
  assert.equal(describeMerge(plan), "1 removed");
  // deleted here; the incoming copy still has it
  plan = planMerge(local([], [{ id: a.id, at: 150 }]), incoming([a]));
  assert.deepEqual(plan.take, []);
  assert.equal(plan.localAhead, true, "the cloud has not heard of the deletion");
  assert.deepEqual(plan.removed, [{ id: a.id, at: 150 }]);
});

test("merge: a document edited after its deletion comes back and its record is dropped", () => {
  const a = docWith("A", "1", 400);
  const plan = planMerge(local([], [{ id: a.id, at: 150 }]), incoming([a]));
  assert.deepEqual(plan.take, [a.id]);
  assert.deepEqual(plan.removed, []);
});

test("merge: records of deleted documents are joined and capped", () => {
  const many = Array.from({ length: MAX_REMOVED + 20 }, (_, i) => ({ id: `document-${String(i).padStart(4, "0")}`, at: i + 1 }));
  const plan = planMerge(local([], many.slice(0, 10)), incoming([], many));
  assert.equal(plan.removed.length, MAX_REMOVED);
  assert.equal(plan.removed.at(-1).at, MAX_REMOVED + 20);
});

test("merge: the newer profile wins, the first creation date is kept", () => {
  const mine = profile("Ada", 100);
  const theirs = profile("Ada L", 200);
  let plan = planMerge(local([], [], mine), incoming([], [], theirs));
  assert.equal(plan.profile.name, "Ada L");
  assert.equal(plan.profile.createdAt, 100);
  assert.equal(plan.profileChanged, true);
  assert.equal(plan.localAhead, false);
  plan = planMerge(local([], [], theirs), incoming([], [], mine));
  assert.equal(plan.profile.name, "Ada L");
  assert.equal(plan.profileChanged, false);
  assert.equal(plan.localAhead, true);
  plan = planMerge(local(), incoming([], [], mine));
  assert.equal(plan.profile.name, "Ada");
  assert.equal(describeMerge(plan), "your profile");
});

test("merge: identical copies change nothing and need no upload", () => {
  const a = docWith("A", "1", 100);
  const p = profile("Ada", 5);
  const plan = planMerge(local([a], [], p), incoming([a], [], p));
  assert.deepEqual(plan.take, []);
  assert.deepEqual(plan.drop, []);
  assert.equal(plan.localAhead, false);
  assert.equal(describeMerge(plan), "");
});

test("save file names are plain and dated", () => {
  assert.equal(saveFileName(new Date("2026-11-17T10:00:00Z")), "Kalculator save 2026-11-17.kalcsave");
});
