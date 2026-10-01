import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPersistence } from "./persistence.js";

let directory;
let persistence;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "dedit-persistence-"));
  persistence = createPersistence(directory);
});
afterEach(() => rmSync(directory, { recursive: true, force: true }));

test("missing documents return null", async () => {
  assert.equal(await persistence.fetch({ documentName: "absent" }), null);
});
test("store, fetch and overwrite roundtrip exact binary state", async () => {
  for (const state of [Buffer.from([0, 1, 255]), Buffer.from([4, 5])]) {
    await persistence.store({ documentName: "one", state });
    assert.deepEqual(await persistence.fetch({ documentName: "one" }), state);
  }
});
test("names with punctuation and unicode never alias", async () => {
  const names = ["a/b", "a_b", "a?b", "日本", "中文", "../escape"];
  for (const documentName of names) await persistence.store({ documentName, state: Buffer.from(documentName) });
  for (const documentName of names) assert.equal((await persistence.fetch({ documentName })).toString(), documentName);
  assert.equal(readdirSync(directory).length, names.length);
});
test("legacy safe-name files remain readable", async () => {
  writeFileSync(join(directory, "legacy-id.yjs"), Buffer.from("legacy"));
  assert.equal((await persistence.fetch({ documentName: "legacy-id" })).toString(), "legacy");
});
test("failed writes do not destroy the prior document", async () => {
  await persistence.store({ documentName: "one", state: Buffer.from("original") });
  await assert.rejects(persistence.store({ documentName: "one", state: undefined }));
  assert.equal((await persistence.fetch({ documentName: "one" })).toString(), "original");
});
