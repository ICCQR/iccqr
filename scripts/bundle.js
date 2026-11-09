#!/usr/bin/env node
// Builds the browser bundle: dist/iccqr.js (readable) and dist/iccqr.min.js.
// Both define one global, ICCQR, with the same API as require('iccqr').
// Runs automatically before `npm pack` and `npm publish`.
//
// Usage: node scripts/bundle.js [output directory]
'use strict';
const fs = require('fs');
const path = require('path');
const { minify } = require('terser');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'dist'));
const pkg = require('../package.json');

// Every require() in lib/ and the file it maps to. A require() missing here fails the build.
const MODULES = {
  './index.js': 'lib/index.js',
  './core.js': 'lib/core.js',
  './marker.js': 'lib/marker.js',
  './glyphs.json': 'lib/glyphs.json',
  '../package.json': null, // only the version is needed in the browser
  'qrcode-generator': require.resolve('qrcode-generator/qrcode.js'),
};

const HEADER = `/*! iccqr ${pkg.version} | 0BSD | https://github.com/iccqr/iccqr
 *  Includes qrcode-generator 1.4.4, (c) 2009 Kazuhiko Arase, MIT license, and glyph
 *  outlines from Archivo and IBM Plex Mono, SIL Open Font License 1.1 (see licenses/). */
`;

function source(id) {
  if (id === '../package.json') return `module.exports = ${JSON.stringify({ version: pkg.version })};`;
  const file = path.resolve(ROOT, MODULES[id]);
  const text = fs.readFileSync(file, 'utf8');
  if (file.endsWith('.json')) return `module.exports = ${JSON.stringify(JSON.parse(text))};`;
  for (const [, dep] of text.matchAll(/require\(['"]([^'"]+)['"]\)/g)) {
    if (!(dep in MODULES)) throw new Error(`${MODULES[id]} requires "${dep}", which scripts/bundle.js doesn't know`);
  }
  return text;
}

(async () => {
  const defs = Object.keys(MODULES)
    .map(id => `${JSON.stringify(id)}: function (module, exports, require) {\n${source(id)}\n}`)
    .join(',\n');
  // No 'use strict' here: lib/ files declare it themselves, and qrcode-generator is sloppy-mode code.
  const code = `(function (global) {
var defs = {
${defs}
};
var cache = {};
function load(id) {
  if (!(id in cache)) {
    var module = { exports: {} };
    cache[id] = module;
    defs[id].call(module.exports, module, module.exports, load);
  }
  return cache[id].exports;
}
global.ICCQR = load('./index.js');
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;
  const min = await minify(code, { compress: true, mangle: true, format: { comments: false } });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'iccqr.js'), HEADER + code);
  fs.writeFileSync(path.join(OUT, 'iccqr.min.js'), HEADER + min.code + '\n');
  for (const f of ['iccqr.js', 'iccqr.min.js']) {
    console.log(`${path.relative(process.cwd(), path.join(OUT, f))}: ${fs.statSync(path.join(OUT, f)).size.toLocaleString()} bytes`);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
