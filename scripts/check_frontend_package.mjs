import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const format = process.argv[2];
if (!format) {
  // Each module format gets its own process to avoid loading Yjs twice.
  for (const entryFormat of ['esm', 'cjs']) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), entryFormat], { stdio: 'inherit' });
    assert.equal(result.status, 0, `${entryFormat} package entry failed`);
  }
} else {
  const entry = format === 'esm'
    ? await import('../frontend/dist/index.js')
    : createRequire(import.meta.url)('../frontend/dist/index.cjs');
  assert.equal(typeof entry.createDeditExtensions, 'function');
  const names = entry.createDeditExtensions().map(extension => extension.name);
  assert.ok(names.includes('table'));
  assert.ok(names.includes('paragraph'));
  console.log(`${format} package entry loads and creates the editor schema extensions`);
}
