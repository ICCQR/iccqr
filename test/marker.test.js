// makeMarker(), readMarker() and the printed SVG. Run with: npm test
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const jsQR = require('jsqr');
const iccqr = require('../lib/index.js');

const example = iccqr.exampleICC();
const srgb = fs.readFileSync(path.join(__dirname, 'profiles', 'littlecms-srgb.icc'));

// Reads the QR code back out of the SVG the way a phone would: rasterize it, then scan.
function scanSVG(svg) {
  const qrPath = /<path d="([^"]+)" fill="#000" shape-rendering="crispEdges"\/>/.exec(svg)[1];
  const rects = [...qrPath.matchAll(/M(\d+) ([\d.]+)h(\d+)v1h-\d+z/g)].map(m => [+m[1], +m[2], +m[3]]);
  const top = Math.min(...rects.map(r => r[1]));
  const n = Math.max(...rects.map(r => r[0] + r[2])) - 4;
  const px = 4, quiet = 4, size = (n + 2 * quiet) * px;
  const img = new Uint8ClampedArray(size * size * 4).fill(255);
  for (const [x, y, w] of rects) {
    const row = Math.round(y - top) + quiet, col = x - 4 + quiet;
    for (let yy = row * px; yy < (row + 1) * px; yy++) {
      for (let xx = col * px; xx < (col + w) * px; xx++) img.fill(0, (yy * size + xx) * 4, (yy * size + xx) * 4 + 3);
    }
  }
  const found = jsQR(img, size, size);
  return found && found.data;
}

test('makeMarker: the printed code scans back to the link', async () => {
  for (const ecc of ['M', 'Q', 'H']) {
    const m = await iccqr.makeMarker(example, { note: 'Brightness 35 · Contrast 75', ecc });
    assert.equal(scanSVG(m.svg), m.url, `level ${ecc}`);
    assert.ok(m.url.startsWith('https://iccqr.github.io/#'));
    assert.equal(m.qr.ecc, ecc);
    assert.equal(m.qr.modules, m.qr.version * 4 + 17);
  }
});

test('makeMarker: the SVG has a title, the date, the note, and a size in millimetres', async () => {
  const m = await iccqr.makeMarker(example, { note: 'A & B <test>', moduleMm: 0.6 });
  assert.match(m.svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="[\d.]+mm" height="[\d.]+mm"/);
  assert.match(m.svg, /<title>ICCQR Calibration Marker 2026-11-08<\/title>/);
  assert.ok(m.svg.includes('A &amp; B &lt;test&gt;'), 'the note is escaped');
  const width = +/width="([\d.]+)mm"/.exec(m.svg)[1];
  assert.equal(width, +((m.qr.modules + 8) * 0.6).toFixed(2));
  assert.equal(m.size.widthMm, +width.toFixed(1));
  assert.equal(m.fileName, 'iccqr-marker_Studio-left_2026-11-08.svg');
});

test('makeMarker: options', async () => {
  const m = await iccqr.makeMarker(srgb, { name: 'Desk', date: '2027-03-04', base: 'https://example.org/decoder/', samples: 17 });
  assert.ok(m.url.startsWith('https://example.org/decoder/#'));
  assert.equal(m.date, '2027-03-04');
  assert.equal(m.record.desc, 'Desk');
  const back = await iccqr.readMarker(m.url);
  assert.deepEqual(back.record.date, { y: 2027, mo: 3, d: 4, h: 22, mi: 38 }); // the profile's own time of day
  assert.equal(back.fileName, 'Desk_2027-03-04.icc');

  // The profile's own time of day is kept when only the date changes.
  const kept = await iccqr.makeMarker(example, { date: '2027-01-02' });
  assert.deepEqual(kept.record.date, { y: 2027, mo: 1, d: 2, h: 9, mi: 42 });
  // A profile that was already parsed works too.
  const parsed = await iccqr.makeMarker(iccqr.parseICC(example.buffer));
  assert.equal(parsed.url, (await iccqr.makeMarker(example)).url);
});

test('makeMarker: bad options get messages for people', async () => {
  const cases = [
    [{ note: 'x'.repeat(iccqr.NOTE_MAX + 1) }, /keep it to 36/],
    [{ ecc: 'X' }, /Error correction/],
    [{ samples: 1 }, /Curve detail/],
    [{ moduleMm: 0 }, /module size/],
    [{ base: 'not a url' }, /isn’t a valid web address/],
    [{ date: '8 Nov 2026' }, /YYYY-MM-DD/],
    [{ date: '2026-13-01' }, /isn’t a valid date/],
    [{ date: '1999-12-31' }, /between 2000 and 2255/],
    [{ base: 'https://example.org/' + 'x'.repeat(2400) }, /more data than one QR code holds/],
  ];
  for (const [options, message] of cases) await assert.rejects(iccqr.makeMarker(example, options), message, JSON.stringify(options).slice(0, 60));
  await assert.rejects(iccqr.makeMarker(new Uint8Array(200)), /not an ICC profile/);
});

test('readMarker: accepts a link, a bare payload, or a link with spaces and escapes', async () => {
  const m = await iccqr.makeMarker(example, { note: 'n' });
  const expected = iccqr.buildICC(await iccqr.decode(m.payload));
  for (const input of [m.url, m.payload, ` ${m.url}\n`, m.url.replace('#', '#%20').replace(/(.{40})/, '$1 ')]) {
    const r = await iccqr.readMarker(input);
    assert.deepEqual(r.icc, expected);
  }
  await assert.rejects(iccqr.readMarker('https://iccqr.github.io/'), /isn’t an ICCQR marker link/);
  await assert.rejects(iccqr.readMarker('https://iccqr.github.io/#hello!'), /isn’t an ICCQR marker link/);
  await assert.rejects(iccqr.readMarker('https://iccqr.github.io/#AAAAAAAAAAAA'), /damaged or incomplete/);
});

test('summarize: rows for people', async () => {
  const rows = Object.fromEntries(iccqr.summarize((await iccqr.readMarker((await iccqr.makeMarker(example)).url)).record));
  assert.equal(rows['White luminance'], '119.6 cd/m²');
  assert.equal(rows['Black level'], '0.13 cd/m²');
  assert.equal(rows['Contrast ratio'], '923:1');
  assert.equal(rows['ICC version'], '2.4');
  assert.equal(Object.fromEntries(iccqr.summarize(iccqr.parseICC(srgb.buffer.slice(srgb.byteOffset, srgb.byteOffset + srgb.length))))['Black level'], 'not recorded');
});
