// The browser bundle must behave exactly like the Node package. Run with: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const iccqr = require('../lib/index.js');

test('dist/iccqr.min.js defines ICCQR and gives the same results as the package', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iccqr-bundle-'));
  try {
    execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'bundle.js'), dir]);
    for (const file of ['iccqr.js', 'iccqr.min.js']) {
      // Only what a browser page has, nothing from Node.
      const page = { CompressionStream, DecompressionStream, Blob, Response, TextEncoder, TextDecoder, URL };
      page.globalThis = page;
      vm.createContext(page);
      vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), page, { filename: file });
      const B = page.ICCQR;
      assert.equal(B.version, iccqr.version, file);
      const options = { note: 'Brightness 35', ecc: 'H' };
      const a = await B.makeMarker(B.exampleICC(), options), b = await iccqr.makeMarker(iccqr.exampleICC(), options);
      assert.equal(a.svg, b.svg, file);
      assert.equal(a.url, b.url, file);
      assert.deepEqual(Array.from((await B.readMarker(a.url)).icc), Array.from((await iccqr.readMarker(b.url)).icc), file);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
