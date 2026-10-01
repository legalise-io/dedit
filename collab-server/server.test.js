import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HocuspocusProvider } from "@hocuspocus/provider";
import WebSocket from "ws";
import * as Y from "yjs";
import { createCollabServer } from "./server.js";

async function eventually(condition, milliseconds = 4000) {
  const deadline = Date.now() + milliseconds;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for collaboration sync");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test("two real clients sync over WebSocket and persist across server restart", { timeout: 12000 }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "dedit-server-"));
  const servers = [], providers = [], docs = [];
  try {
    const server = createCollabServer({ port: 0, dataDir: directory, quiet: true });
    servers.push(server);
    await server.listen();
    const url = `ws://127.0.0.1:${server.httpServer.address().port}`;
    for (let i = 0; i < 2; i++) {
      const document = new Y.Doc();
      docs.push(document);
      providers.push(new HocuspocusProvider({ url, name: "shared", document, WebSocketPolyfill: WebSocket }));
    }
    await eventually(() => providers.every(provider => provider.isSynced));
    docs[0].getText("text").insert(0, "Collaborative text");
    await eventually(() => docs[1].getText("text").toString() === "Collaborative text");
    for (const provider of providers.splice(0)) provider.destroy();
    await server.destroy();
    servers.splice(0);
    const restarted = createCollabServer({ port: 0, dataDir: directory, quiet: true });
    servers.push(restarted);
    await restarted.listen();
    const document = new Y.Doc();
    docs.push(document);
    const provider = new HocuspocusProvider({ url: `ws://127.0.0.1:${restarted.httpServer.address().port}`, name: "shared", document, WebSocketPolyfill: WebSocket });
    providers.push(provider);
    await eventually(() => provider.isSynced);
    assert.equal(document.getText("text").toString(), "Collaborative text");
  } finally {
    for (const provider of providers) provider.destroy();
    for (const server of servers) await server.destroy();
    for (const doc of docs) doc.destroy();
    rmSync(directory, { recursive: true, force: true });
  }
});
