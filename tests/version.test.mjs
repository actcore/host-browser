import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { HOST_VERSION } from '../dist/version.js';

test('HOST_VERSION mirrors package.json (run `npm run gen-version`)', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(
    HOST_VERSION,
    pkg.version,
    'src/version.ts is stale — `npm run gen-version` regenerates it from package.json',
  );
});
