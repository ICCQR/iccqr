# iccqr

Turn a display's ICC profile into a printable QR code, a *calibration marker*, and stick it on the display it belongs to. Scanning the marker opens a link that holds the calibration. This package turns that link back into the `.icc` file.

When you recalibrate, print a new marker and stick it on top of the old one. The newest calibration is always the one you can scan.

This is the library and command-line tool behind **https://iccqr.github.io/**.

## Command line

```sh
npx iccqr make studio.icc --note "Brightness 35 · Contrast 75"
```

```
Wrote iccqr-marker_Studio-left_2026-11-08.svg (46.5 × 57.8 mm)
Link: https://iccqr.github.io/#HWGTCSYDIEIILX6MZ3XN4ZJZ…
QR version 17, 85×85 modules, level Q, 289 bytes of data
Match to file: 0.05 8-bit steps at most
```

Print the SVG at 100% scale. Scan the marker later, then:

```sh
npx iccqr read "https://iccqr.github.io/#HWGTCSYDIEIILX6MZ3XN4ZJZ…"   # writes Studio-left_2026-11-08.icc
npx iccqr info studio.icc                                               # white point, black level, contrast…
```

| Command | Does |
|---|---|
| `iccqr make <profile.icc>` | Writes the marker SVG and prints its link |
| `iccqr read <link>` | Rebuilds the `.icc` file from a scanned link (or from standard input) |
| `iccqr info <profile.icc \| link>` | Shows what a profile or marker carries |

Options for `make`: `--note` (one line printed under the date, up to 36 characters; the display's own settings are a good use), `--name` (the profile name shown when picking it), `--date YYYY-MM-DD`, `--samples 17|33|65`, `--ecc L|M|Q|H`, `--module-mm` (default 0.5), `--base` (decoder address). `-o` sets the output file (`-` for standard output), `--force` overwrites. `iccqr --help` lists everything.

## Library

```sh
npm install iccqr
```

```js
const fs = require('fs');
const { makeMarker, readMarker, summarize } = require('iccqr');

const marker = await makeMarker(fs.readFileSync('studio.icc'), { note: 'Brightness 35 · Contrast 75' });
fs.writeFileSync(marker.fileName, marker.svg);
console.log(marker.url);

const { icc, fileName, record } = await readMarker(marker.url);
fs.writeFileSync(fileName, icc);
console.log(summarize(record)); // [['White point', '0.3134, 0.3297 · 6462 K'], …]
```

**`makeMarker(profile, options)`** takes the `.icc` file as an `ArrayBuffer`, `Uint8Array` or `Buffer` (or a profile from `parseICC()`) and resolves to:

| Field | |
|---|---|
| `url` | The link the QR code holds |
| `svg` | The printable marker |
| `fileName` | A suggested file name for the SVG |
| `payload` | The marker data alone, the part after `#` |
| `qr` | `{ version, modules, ecc }` |
| `size` | `{ widthMm, heightMm }` when printed |
| `match` | Largest difference between the original curves and the marker's, in 8-bit code steps; `0` means exact |
| `record`, `date`, `dataBytes` | The decoded marker record, its date as `YYYY-MM-DD`, and the compressed size |

Options: `note`, `name`, `date` (`"YYYY-MM-DD"`, a `Date`, or the profile's date by default), `samples` (33), `ecc` (`"Q"`), `moduleMm` (0.5), `base` (`"https://iccqr.github.io/"`). Bad input rejects with an `Error` whose message is written for people, so it can be shown as it is.

**`readMarker(link)`** accepts a full link or just the payload and resolves to `{ icc, fileName, date, record }`, with `icc` a `Uint8Array` holding a complete profile.

**`summarize(record)`** returns `[label, value]` rows describing a marker record or a parsed profile.

The codec underneath is exported too: `parseICC`, `compact`, `encode`, `decode`, `buildICC`, `pack`, `unpack`, `blackLevel`, `chromaticities` and more. [FORMAT.md](FORMAT.md) describes the marker format byte by byte.

### In the browser

`dist/iccqr.min.js` (about 60 KB) defines one global, `ICCQR`, with the same API. It has no dependencies and works from a local file. Load it from the npm package, or from a CDN pinned to an exact version:

```html
<script src="https://cdn.jsdelivr.net/npm/iccqr@1.0.0/dist/iccqr.min.js"></script>
```

It needs `CompressionStream` with `deflate-raw`: Chrome 103, Firefox 113, Safari 16.4 or newer. In Node, version 20.12 or newer.

## Compatibility

Printed markers must keep working, so the marker format never breaks: every version of this package decodes every marker made by an earlier one. The tests enforce it with a payload from the first release. New optional fields are added in a way older decoders skip over. See [FORMAT.md](FORMAT.md#rules-for-changing-the-format).

Package versions follow semver for the JavaScript API and the command line, independently of the marker format.

## Development

```sh
npm ci
npm test     # codec, compatibility, fuzzing, marker scanning, command line, browser bundle
```

`npm test` also scans every generated marker with a QR reader. To test with your own calibration profiles, put `.icc` files in `test/profiles/`. Releasing is described in [RELEASING.md](RELEASING.md).

The marker's title and date digits are pre-drawn outlines in `lib/glyphs.json`. To change the title text or its fonts, regenerate them (needs Python 3):

```sh
pip install fonttools brotli
python3 scripts/glyphs.py
```

## License

[0BSD](LICENSE). The browser bundle includes qrcode-generator by Kazuhiko Arase (MIT), and the marker's title and date are drawn with outlines from the Archivo and IBM Plex Mono fonts (SIL Open Font License 1.1). Their license texts are in [licenses/](licenses/).
