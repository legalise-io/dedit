import { Server } from "@hocuspocus/server";
import { Database } from "@hocuspocus/extension-database";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPersistence } from "./persistence.js";

const filename = fileURLToPath(import.meta.url);
const defaultDataDir = join(dirname(filename), "data");

/** Construct the server without starting its listener. */
export function createCollabServer({ port = 1234, dataDir = defaultDataDir, quiet = false } = {}) {
  return new Server({ port, quiet, extensions: [new Database(createPersistence(dataDir))] });
}

if (process.argv[1] && resolve(process.argv[1]) === filename) {
  const server = createCollabServer();
  console.log(`Hocuspocus collaboration server: ws://localhost:1234\nData directory: ${defaultDataDir}`);
  server.listen();
}
