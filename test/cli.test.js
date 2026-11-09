// The iccqr command. Run with: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const iccqr = require('../lib/index.js');

const BIN = path.join(__dirname, '..', 'bin', 'iccqr.js');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iccqr-cli-'));
fs.writeFileSync(path.join(dir, 'studio.icc'), iccqr.exampleICC());
const run = (args, input) => spawnSync(process.execPath, [BIN, ...args], { cwd: dir, input, encoding: 'utf8' });
test.after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('make writes the SVG and prints the link', () => {
  const r = run(['make', 'studio.icc', '--note', 'Brightness 35', '--ecc', 'H', '--module-mm', '0.6']);
  assert.equal(r.status, 0, r.stderr);
  const svg = fs.readFileSync(path.join(dir, 'iccqr-marker_Studio-left_2026-11-08.svg'), 'utf8');
  assert.match(svg, /^<svg[^>]+width="[\d.]+mm"/);
  assert.match(r.stdout, /^Wrote iccqr-marker_Studio-left_2026-11-08\.svg \([\d.]+ × [\d.]+ mm\)$/m);
  assert.match(r.stdout, /^Link: https:\/\/iccqr\.github\.io\/#[A-Z2-7]+$/m);
  assert.match(r.stdout, /level H/);
});

test('make -o - writes the SVG to standard output and messages to standard error', () => {
  const r = run(['make', 'studio.icc', '-o', '-']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^<svg /);
  assert.match(r.stderr, /^Link: /m);
});

test('read rebuilds the profile from a link, given or piped', async () => {
  const link = /^Link: (\S+)$/m.exec(run(['make', 'studio.icc', '-o', '-']).stderr)[1];
  const expected = (await iccqr.readMarker(link)).icc;

  const r = run(['read', link, '-o', 'from-arg.icc']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(dir, 'from-arg.icc'))), expected);
  assert.match(r.stdout, /calibrated 2026-11-08, "Studio left"/);

  const piped = run(['read', '-o', 'from-stdin.icc'], link + '\n');
  assert.equal(piped.status, 0, piped.stderr);
  assert.deepEqual(new Uint8Array(fs.readFileSync(path.join(dir, 'from-stdin.icc'))), expected);
});

test('info describes a profile file and a link', () => {
  const file = run(['info', 'studio.icc']);
  assert.equal(file.status, 0, file.stderr);
  assert.match(file.stdout, /Contrast ratio\s+923:1/);
  const link = /^Link: (\S+)$/m.exec(run(['make', 'studio.icc', '-o', '-']).stderr)[1];
  const marker = run(['info', link]);
  assert.equal(marker.status, 0, marker.stderr);
  assert.match(marker.stdout, /^Marker: calibrated 2026-11-08, "Studio left"$/m);
});

test('refuses to overwrite files without --force', () => {
  fs.writeFileSync(path.join(dir, 'keep.svg'), 'mine');
  const r = run(['make', 'studio.icc', '-o', 'keep.svg']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /keep\.svg already exists\. Use --force/);
  assert.equal(fs.readFileSync(path.join(dir, 'keep.svg'), 'utf8'), 'mine');
  assert.equal(run(['make', 'studio.icc', '-o', 'keep.svg', '--force']).status, 0);
});

test('errors: exit 1 with a message, usage mistakes exit 2', () => {
  const missing = run(['make', 'nope.icc']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^iccqr: Can’t read nope\.icc: no such file$/m);
  const bad = run(['read', 'https://iccqr.github.io/#AAAAAAAAAAAA']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /damaged or incomplete/);
  for (const args of [['frobnicate'], ['make'], ['make', 'studio.icc', '--colour', 'red']]) {
    const r = run(args);
    assert.equal(r.status, 2, args.join(' '));
    assert.match(r.stderr, /iccqr --help/);
  }
});

test('--help and --version', () => {
  assert.match(run(['--help']).stdout, /^Usage:/m);
  assert.equal(run(['--version']).stdout.trim(), iccqr.version);
});
