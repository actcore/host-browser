import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { deriveTranspileCacheKey } from '../dist/cache.js';
import { HOST_VERSION } from '../dist/version.js';

const BYTES = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const sha256Hex = (u8) => createHash('sha256').update(u8).digest('hex');

const baseInput = {
  bytes: BYTES,
  name: 'component',
  shimBase: 'https://cdn.example/preview2-shim/',
  wasiHttpShimUrl: 'https://cdn.example/host/shims/wasi-http.js',
};

test('cache key includes the host version', async () => {
  const key = await deriveTranspileCacheKey(baseInput);
  assert.ok(key.includes(HOST_VERSION), `key "${key}" must contain HOST_VERSION ${HOST_VERSION}`);
});

test('cache key includes the SHA-256 of the original module', async () => {
  const key = await deriveTranspileCacheKey(baseInput);
  assert.ok(key.includes(sha256Hex(BYTES)), 'key must contain the module SHA-256');
});

test('cache key is deterministic for identical inputs', async () => {
  const a = await deriveTranspileCacheKey(baseInput);
  const b = await deriveTranspileCacheKey({ ...baseInput, bytes: BYTES.slice() });
  assert.equal(a, b);
});

test('different module bytes produce a different key', async () => {
  const other = new Uint8Array([...BYTES, 0xff]);
  const a = await deriveTranspileCacheKey(baseInput);
  const b = await deriveTranspileCacheKey({ ...baseInput, bytes: other });
  assert.notEqual(a, b);
});

test('output-affecting options change the key', async () => {
  const base = await deriveTranspileCacheKey(baseInput);
  const diffName = await deriveTranspileCacheKey({ ...baseInput, name: 'other' });
  const diffShim = await deriveTranspileCacheKey({
    ...baseInput,
    shimBase: 'https://other.example/shim/',
  });
  const diffHttp = await deriveTranspileCacheKey({
    ...baseInput,
    wasiHttpShimUrl: 'https://other.example/wasi-http.js',
  });
  assert.notEqual(base, diffName);
  assert.notEqual(base, diffShim);
  assert.notEqual(base, diffHttp);
});
