'use strict';
// Calibration markers: the printable SVG, and the two everyday calls,
// makeMarker() (profile -> link + SVG) and readMarker() (link -> .icc).
const core = require('./core.js');
const qrcode = require('qrcode-generator');
const GLYPHS = require('./glyphs.json');

const DEFAULT_BASE = 'https://iccqr.github.io/';
const NOTE_MAX = 36;            // what fits on one line under the date at any code size
const ECC_LEVELS = ['L', 'M', 'Q', 'H'];
const PAYLOAD = /^[A-Za-z2-7]{8,}$/;

const pad = n => String(n).padStart(2, '0');
const formatDate = d => (d ? `${d.y}-${pad(d.mo)}-${pad(d.d)}` : 'undated');
const escapeXML = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fileSlug = s => (s || '').normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 40) || 'display';

function toArrayBuffer(x) {
  if (x instanceof ArrayBuffer) return x;
  if (ArrayBuffer.isView(x)) return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength);
  throw new TypeError('Pass the profile as an ArrayBuffer, a Uint8Array or a Buffer.');
}
const isProfile = x => !!x && typeof x === 'object' && Array.isArray(x.wtpt) && Array.isArray(x.trc);

// "YYYY-MM-DD", a Date, or a { y, mo, d, h, mi } record. Keeps the profile's time of day.
function toDate(value, fallback) {
  if (value === undefined || value === '') return fallback || null;
  if (value === null) return null;
  const time = { h: fallback ? fallback.h : 12, mi: fallback ? fallback.mi : 0 };
  let d;
  if (value instanceof Date) d = { y: value.getFullYear(), mo: value.getMonth() + 1, d: value.getDate(), ...time };
  else if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (!m) throw new Error(`Write the calibration date as YYYY-MM-DD, for example 2026-11-08 (got "${value}").`);
    d = { y: +m[1], mo: +m[2], d: +m[3], ...time };
  } else d = { ...time, ...value };
  if (!(d.mo >= 1 && d.mo <= 12 && d.d >= 1 && d.d <= 31)) throw new Error(`${formatDate(d)} isn’t a valid date.`);
  if (d.y < 2000 || d.y > 2255) throw new Error('Choose a calibration date between 2000 and 2255.');
  return d;
}

// The printable marker. Units are QR modules; width and height are set in millimetres.
function drawMarker(qr, { date, note, moduleMm }) {
  const n = qr.getModuleCount(), q = 4, W = n + 2 * q, side = 3;
  // Title, outlined so it prints the same everywhere. Its ink spans exactly the width of the code.
  const T = GLYPHS.title, ts = n / (T.x1 - T.x0), tx = q - T.x0 * ts, yT = side + T.cap * ts;
  const y0 = yT + 3.5;
  let d = '';
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (qr.isDark(r, c)) { let e = c; while (e < n && qr.isDark(r, e)) e++; d += `M${c + q} ${(r + y0).toFixed(2)}h${e - c}v1h${c - e}z`; c = e; } else c++;
    }
  }
  // Date: outlined IBM Plex Mono Bold digits.
  const Mo = GLYPHS.mono, dh = W * 0.07, ds = dh / Mo.cap, adv = Mo.adv * ds;
  const dx0 = (W - date.length * adv) / 2, y1 = y0 + n + 3 + dh;
  const digits = [...date].map((ch, i) => Mo.g[ch] ? `<path transform="translate(${(dx0 + i * adv).toFixed(2)} ${y1.toFixed(2)}) scale(${ds.toFixed(5)})" d="${Mo.g[ch]}"/>` : '').join('');
  const mono = `'IBM Plex Mono','DejaVu Sans Mono',Menlo,Consolas,monospace`;
  let noteSVG = '', H = y1 + side;
  if (note) {
    const avail = W - 2 * side, f = Math.min(W * 0.042, avail / (NOTE_MAX * 0.6)), est = note.length * f * 0.6;
    const y2 = y1 + f * 2;
    noteSVG = `<text x="${W / 2}" y="${y2.toFixed(2)}" text-anchor="middle" font-family="${mono}" font-size="${f.toFixed(2)}"${est > avail ? ` textLength="${avail.toFixed(2)}" lengthAdjust="spacingAndGlyphs"` : ''} fill="#000">${escapeXML(note)}</text>`;
    H = y2 + side;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${(W * moduleMm).toFixed(2)}mm" height="${(H * moduleMm).toFixed(2)}mm" viewBox="0 0 ${W} ${H.toFixed(2)}">
<title>ICCQR Calibration Marker ${escapeXML(date)}</title>
<rect x="0.1" y="0.1" width="${W - 0.2}" height="${(H - 0.2).toFixed(2)}" rx="2.2" fill="#fff" stroke="#c8c8c8" stroke-width="0.2"/>
<path transform="translate(${tx.toFixed(3)} ${yT.toFixed(2)}) scale(${ts.toFixed(6)})" d="${T.d}" fill="#000"/>
<path d="${d}" fill="#000" shape-rendering="crispEdges"/>
<g fill="#000">${digits}</g>${noteSVG}
</svg>`;
  return { svg, width: W, height: +H.toFixed(2) };
}

/**
 * Turns an ICC display profile into a calibration marker.
 * @param profile  the .icc file (ArrayBuffer, Uint8Array or Buffer), or a profile from parseICC()
 * @param options  { note, name, date, samples, ecc, moduleMm, base }
 * @returns {Promise<{url, payload, svg, fileName, date, record, dataBytes, qr, size, match}>}
 */
async function makeMarker(profile, options = {}) {
  const p = isProfile(profile) ? profile : core.parseICC(toArrayBuffer(profile));
  const given = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
  const o = { samples: 33, ecc: 'Q', moduleMm: 0.5, base: DEFAULT_BASE, ...given };
  const note = (o.note || '').trim();
  if ([...note].length > NOTE_MAX) throw new Error(`The note is ${[...note].length} characters long. It has to fit on one line, so keep it to ${NOTE_MAX}.`);
  if (!Number.isInteger(o.samples) || o.samples < 2 || o.samples > 255) throw new Error('Curve detail must be a whole number of points from 2 to 255 (17, 33 or 65 are the usual choices).');
  const ecc = String(o.ecc).toUpperCase();
  if (!ECC_LEVELS.includes(ecc)) throw new Error(`Error correction must be one of ${ECC_LEVELS.join(', ')}.`);
  const moduleMm = Number(o.moduleMm);
  if (!(moduleMm > 0 && moduleMm <= 10)) throw new Error('The module size must be more than 0 and at most 10 mm.');
  let base;
  try { base = new URL(o.base).href.split('#')[0]; } catch (e) { throw new Error(`The decoder address "${o.base}" isn’t a valid web address.`); }
  const date = toDate(o.date, p.date);
  const desc = (o.name !== undefined ? o.name : p.desc || '').trim();

  const record = core.compact(p, { samples: o.samples, desc, model: '', note, date });
  const enc = await core.encode(record);
  const qr = qrcode(0, ecc);
  try {
    qr.addData(base + '#', 'Byte');
    qr.addData(enc.text, 'Alphanumeric');
    qr.make();
  } catch (e) {
    throw new Error('This is more data than one QR code holds. Use fewer curve points, shorten the note or the decoder address, or lower the error correction.');
  }
  const day = formatDate(date);
  const { svg, width, height } = drawMarker(qr, { date: day, note, moduleMm });
  const n = qr.getModuleCount();
  return {
    url: base + '#' + enc.text,
    payload: enc.text,
    svg,
    fileName: `iccqr-marker_${fileSlug(desc)}_${day}.svg`,
    date: day,
    record,
    dataBytes: enc.z.length,
    qr: { version: (n - 17) / 4, modules: n, ecc },
    size: { widthMm: +(width * moduleMm).toFixed(1), heightMm: +(height * moduleMm).toFixed(1) },
    match: Math.max(...record.err.trc, ...record.err.vcgt), // largest curve difference from the file, in 8-bit steps
  };
}

/** The marker data in a link (or the bare payload), or null when there is none. */
function payloadOf(input) {
  let s = String(input || '').trim();
  const hash = s.indexOf('#');
  if (hash >= 0) s = s.slice(hash + 1);
  try { s = decodeURIComponent(s); } catch (e) { return null; }
  s = s.replace(/\s+/g, '');
  return PAYLOAD.test(s) ? s : null;
}

/**
 * Reads a scanned marker link (or its payload) and rebuilds the ICC profile.
 * @returns {Promise<{icc: Uint8Array, fileName, date, record}>}
 */
async function readMarker(input) {
  const payload = payloadOf(input);
  if (!payload) throw new Error('This isn’t an ICCQR marker link. It should look like https://iccqr.github.io/#NCFO…');
  const record = await core.decode(payload);
  const icc = core.buildICC(record);
  const date = formatDate(record.date);
  return { icc, fileName: `${fileSlug(record.desc)}_${date}.icc`, date, record };
}

/** What a profile or marker carries, as [label, value] rows for people to read. */
function summarize(s) {
  const c = core.chromaticities(s), blk = core.blackLevel(s);
  const f = p => `${p[0].toFixed(4)}, ${p[1].toFixed(4)}`;
  const gam = s.trc.map(t => core.effectiveGamma(t)).map(g => (g ? g.toFixed(2) : '–')).join(' / ');
  const vcgt = s.vcgt ? (s.vcgt.kind === 'formula' ? 'formula (gamma, min, max)' : core.describeCurve(s.vcgt.ch[0])) : 'none';
  return [
    ['White point', `${f(c.w)} · ${Math.round(core.cct(c.w))} K`],
    ['White luminance', s.lumiY ? `${s.lumiY.toFixed(1)} cd/m²` : 'not recorded'],
    ['Black level', blk ? `${blk.cdm2 ? `${blk.cdm2.toPrecision(2)} cd/m²` : `${(blk.rel * 100).toPrecision(2)}% of white`}${blk.source === 'curves' ? ' (from tone curves)' : ''}` : 'not recorded'],
    ['Contrast ratio', blk ? `${Math.round(blk.contrast).toLocaleString('en-US')}:1` : 'not recorded'],
    ['Red primary', f(c.r)], ['Green primary', f(c.g)], ['Blue primary', f(c.b)],
    ['Tone curves', `${core.describeCurve(s.trc[0])} · gamma at 50%: ${gam}`],
    ['Video card curves', vcgt],
    ['Adaptation matrix', s.chad ? 'included' : 'none'],
    ['ICC version', `${s.major}.${s.minor >> 4}`],
  ];
}

module.exports = { makeMarker, readMarker, summarize, payloadOf, formatDate, fileSlug, DEFAULT_BASE, NOTE_MAX };
