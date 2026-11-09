#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');
const { parseArgs } = require('util');
const iccqr = require('../lib/index.js');

const HELP = `iccqr ${iccqr.version}: printable QR calibration markers for ICC display profiles

Usage:
  iccqr make <profile.icc> [options]   Make a marker (SVG) and its link
  iccqr read <link> [-o file.icc]      Rebuild the .icc file from a scanned marker link
  iccqr info <profile.icc | link>      Show what a profile or marker carries

Options for make:
  -o, --output <file>    Where to write the SVG ("-" for standard output).
                         Default: iccqr-marker_<name>_<date>.svg
      --note <text>      One line printed under the date, up to ${iccqr.NOTE_MAX} characters,
                         e.g. the display's own settings: "Brightness 35 · Contrast 75"
      --name <text>      Profile name shown when picking the profile (default: the file's)
      --date YYYY-MM-DD  Calibration date (default: the profile's creation date)
      --samples <n>      Points kept per measured curve: 17, 33 (default) or 65
      --ecc <level>      QR error correction: L, M, Q (default) or H
      --module-mm <mm>   Size of one QR module when printed (default 0.5)
      --base <url>       Decoder address (default ${iccqr.DEFAULT_BASE})

Options for read:
  -o, --output <file>    Where to write the profile. Default: <name>_<date>.icc
                         A link of "-", or none, is read from standard input.

  -f, --force            Overwrite an existing output file
  -h, --help             Show this help
  -v, --version          Show the version`;

class UsageError extends Error {}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch (e) { return ''; }
}

function writeOut(file, data, force) {
  if (file === '-') { process.stdout.write(data); return; }
  if (!force && fs.existsSync(file)) throw new Error(`${file} already exists. Use --force to overwrite it.`);
  fs.writeFileSync(file, data);
}

function readProfileFile(file) {
  let bytes;
  try { bytes = fs.readFileSync(file); } catch (e) { throw new Error(`Can’t read ${file}: ${e.code === 'ENOENT' ? 'no such file' : e.message}`); }
  return iccqr.parseICC(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

function table(rows) {
  const w = Math.max(...rows.map(r => r[0].length));
  return rows.map(([k, v]) => `  ${k.padEnd(w)}  ${v}`).join('\n');
}

async function make(args, o, log) {
  if (args.length !== 1) throw new UsageError('make needs one profile file.');
  const profile = readProfileFile(args[0]);
  const samples = o.samples === undefined ? undefined : Number(o.samples);
  const m = await iccqr.makeMarker(profile, {
    note: o.note, name: o.name, date: o.date, samples, ecc: o.ecc,
    moduleMm: o['module-mm'] === undefined ? undefined : Number(o['module-mm']), base: o.base,
  });
  const out = o.output || m.fileName;
  writeOut(out, m.svg, o.force);
  if (out !== '-') log(`Wrote ${out} (${m.size.widthMm} × ${m.size.heightMm} mm)`);
  log(`Link: ${m.url}`);
  log(`QR version ${m.qr.version}, ${m.qr.modules}×${m.qr.modules} modules, level ${m.qr.ecc}, ${m.dataBytes} bytes of data`);
  log(`Match to file: ${m.match < 0.0005 ? 'exact' : `${m.match.toFixed(2)} 8-bit steps at most`}`);
  if (profile.hasLUT) log('Note: this profile also has LUT tables. The marker carries its matrix/shaper part.');
}

async function read(args, o, log) {
  if (args.length > 1) throw new UsageError('read takes one link.');
  const link = !args.length || args[0] === '-' ? readStdin() : args[0];
  const r = await iccqr.readMarker(link);
  const out = o.output || r.fileName;
  writeOut(out, r.icc, o.force);
  log(`${out === '-' ? 'Wrote the profile' : `Wrote ${out}`}: calibrated ${r.date}${r.record.desc ? `, "${r.record.desc}"` : ''}${r.record.note ? `, ${r.record.note}` : ''}`);
}

async function info(args, o, log) {
  if (args.length !== 1) throw new UsageError('info needs one profile file or link.');
  const arg = args[0];
  if (fs.existsSync(arg)) {
    const p = readProfileFile(arg);
    log(`${arg}${p.desc ? `: "${p.desc}"` : ''}${p.date ? `, created ${iccqr.formatDate(p.date)}` : ''}`);
    log(table(iccqr.summarize(p)));
    if (p.hasLUT) log('  (also has LUT tables, which a marker doesn’t carry)');
  } else {
    const r = await iccqr.readMarker(arg);
    log(`Marker: calibrated ${r.date}${r.record.desc ? `, "${r.record.desc}"` : ''}`);
    if (r.record.note) log(`  ${r.record.note}`);
    log(table(iccqr.summarize(r.record)));
  }
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv, allowPositionals: true, strict: true,
      options: {
        output: { type: 'string', short: 'o' }, note: { type: 'string' }, name: { type: 'string' }, date: { type: 'string' },
        samples: { type: 'string' }, ecc: { type: 'string' }, 'module-mm': { type: 'string' }, base: { type: 'string' },
        force: { type: 'boolean', short: 'f' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (e) { throw new UsageError(e.message); }
  const { values: o, positionals: [cmd, ...args] } = parsed;
  if (o.version) { console.log(iccqr.version); return; }
  if (o.help || !cmd) { console.log(HELP); return; }
  // When the SVG or profile goes to standard output, messages go to standard error.
  const log = o.output === '-' ? m => console.error(m) : m => console.log(m);
  const commands = { make, read, info };
  if (!commands[cmd]) throw new UsageError(`Unknown command "${cmd}".`);
  await commands[cmd](args, o, log);
}

main(process.argv.slice(2)).catch(e => {
  console.error(`iccqr: ${e.message}`);
  if (e instanceof UsageError) console.error('Run "iccqr --help" for usage.');
  process.exitCode = e instanceof UsageError ? 2 : 1;
});
