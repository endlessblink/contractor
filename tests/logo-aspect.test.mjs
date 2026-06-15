import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readImageSize, fitLogo } from '../src/generate-quote.mjs';

// Build a minimal 24-byte PNG header (signature + IHDR width@16 / height@20).
function pngHeader(width, height) {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

test('readImageSize reads PNG dimensions', () => {
  assert.deepEqual(readImageSize(pngHeader(1312, 736)), { width: 1312, height: 736 });
});

test('readImageSize returns null for non-image / too-short buffers', () => {
  assert.equal(readImageSize(Buffer.from([1, 2, 3])), null);
  assert.equal(readImageSize(null), null);
});

test('fitLogo preserves aspect ratio for a landscape logo (regression: was forced to 80x80)', () => {
  // 1312x736 ≈ 1.78:1 — the real footer logo that used to be squished into a square.
  const dims = fitLogo(pngHeader(1312, 736), 80);
  assert.equal(dims.width, 80, 'longest side fills the box');
  assert.equal(dims.height, 45, 'shorter side scales proportionally');
  assert.notEqual(dims.height, 80, 'must NOT be a stretched square');
});

test('fitLogo handles portrait logos', () => {
  const dims = fitLogo(pngHeader(400, 800), 80);
  assert.equal(dims.height, 80);
  assert.equal(dims.width, 40);
});

test('fitLogo keeps a square logo square', () => {
  assert.deepEqual(fitLogo(pngHeader(512, 512), 80), { width: 80, height: 80 });
});

test('fitLogo falls back to the full box for unparseable buffers', () => {
  assert.deepEqual(fitLogo(Buffer.from([0, 1, 2]), 80), { width: 80, height: 80 });
});
