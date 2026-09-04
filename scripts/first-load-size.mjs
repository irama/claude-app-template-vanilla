#!/usr/bin/env node
// First-load JS size gate.
//
// Next 16 + Turbopack emits hashed, flattened chunk filenames, so a filename
// glob cannot tell first-load chunks apart from lazy route chunks. The old
// size-limit config summed EVERY file in `.next/static/chunks/*.js`, which
// punished already-split routes even though users never download them first.
//
// build-manifest.json resolves the hashes: `rootMainFiles` + `polyfillFiles`
// are exactly what every route ships on first load. Route-lazy chunks are
// correctly excluded, so splitting a heavy feature out now lowers this number.
//
// ponytail: LIMIT_KB is the calibration knob. Raise it deliberately, with a
// dated note, when first-load legitimately grows — don't silently bump it.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { brotliCompressSync } from 'node:zlib';

const LIMIT_KB = 300; // brotli first-load ceiling. Measured: 212.5 kB (2026-07-21).

const manifestPath = '.next/build-manifest.json';
if (!existsSync(manifestPath)) {
  console.error(`✗ ${manifestPath} not found — run \`next build\` first.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const files = [...(manifest.rootMainFiles ?? []), ...(manifest.polyfillFiles ?? [])];

let bytes = 0;
for (const f of files) {
  const p = join('.next', f);
  if (existsSync(p)) bytes += brotliCompressSync(readFileSync(p)).length;
}

const limitBytes = LIMIT_KB * 1024;
const kb = (bytes / 1024).toFixed(1);
const pct = ((bytes / limitBytes) * 100).toFixed(0);
console.log(`First-load JS (brotli): ${kb} kB / ${LIMIT_KB} kB  (${pct}%, ${files.length} chunks)`);

if (bytes > limitBytes) {
  console.error(`✗ First-load exceeds limit by ${((bytes - limitBytes) / 1024).toFixed(1)} kB`);
  process.exit(1);
}
console.log('✓ within budget');
