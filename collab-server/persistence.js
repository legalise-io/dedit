import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

/** Persistence callbacks isolated from the listener for testing. */
export function createPersistence(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const getDocPath = documentName => join(dataDir, `${createHash("sha256").update(documentName).digest("hex")}.yjs`);
  return {
    fetch: async ({ documentName }) => {
      const path = getDocPath(documentName);
      if (existsSync(path)) return readFileSync(path);
      if (/^[a-zA-Z0-9_-]+$/.test(documentName)) {
        const legacy = join(dataDir, `${documentName}.yjs`);
        if (existsSync(legacy)) return readFileSync(legacy);
      }
      return null;
    },
    store: async ({ documentName, state }) => {
      const path = getDocPath(documentName);
      const temporary = `${path}.${randomUUID()}.tmp`;
      try {
        writeFileSync(temporary, state);
        renameSync(temporary, path);
      } finally {
        rmSync(temporary, { force: true });
      }
    },
  };
}
