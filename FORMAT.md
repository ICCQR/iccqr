# ICCQR marker format

This is the reference for what a calibration marker contains. `lib/core.js` implements it, and its header comment is the short version of this document.

**The format is permanent.** Every marker ever printed carries it, so every future version of this package, and anything else that reads markers, must keep decoding format 1 forever. The rules at the end of this document say how it can still grow.

## Encoding chain

1. `compact()` reduces a parsed profile to a *marker record*.
2. `pack()` writes the record as bytes (big-endian), described below.
3. The bytes are compressed with raw DEFLATE (`CompressionStream('deflate-raw')`).
4. The result is written as base32 (RFC 4648 alphabet `A–Z 2–7`, no padding).
5. The link is `<decoder address>#<base32>`.

Base32 is chosen because its alphabet is a subset of the QR *alphanumeric* mode, which stores 5.5 bits per character instead of byte mode's 8. The QR code is therefore made of two segments: the address plus `#` in byte mode, and the payload in alphanumeric mode. A typical calibrated profile (separate R, G, B tone curves and video card curves) is about 280 compressed bytes, or about 460 characters.

## Record layout

| Field | Size | Notes |
|---|---|---|
| format | u8 | `1`. A future format bumps this; decoders reject numbers they don't know with a clear message. |
| flags | u8 | `1` chad present · `2` lumi present · `4` vcgt present · `8` one tone curve shared by R, G, B · `16` one vcgt curve shared · `32` vcgt is a formula · `64` black point present (an extension, see below). Bit 128 is reserved and must be 0. |
| ICC version | u8, u8 | Major and minor byte of the source profile. The rebuilt profile uses the same version. |
| date | 5 × u8 | Year − 2000, month, day, hour, minute. Year range is 2000–2255. |
| wtpt, rXYZ, gXYZ, bXYZ | 12 × int24 | Raw s15Fixed16 values from the profile, copied exactly. |
| chad | 9 × int24 | If flag 1. The chromatic adaptation matrix, raw s15Fixed16. |
| lumi | int24 | If flag 2. White luminance × 10, in cd/m². |
| tone curves | 1 or 3 curves | One if flag 8, otherwise R, G, B. |
| vcgt | formula or 1 or 3 curves | If flag 4. A formula is 9 × int24 (gamma, min, max for each channel, raw s15Fixed16). |
| description | string | The profile name your system shows. |
| model | string | Always empty now. Kept so the layout doesn't change. |
| note | string | Printed on the marker. The page limits it to 36 characters. |

A string is a u8 byte length followed by that many bytes of UTF-8 (cut at 255 bytes on a character boundary).

## Extensions

Optional fields added after the first release go **after the note**, in the order of their flag bits. A decoder reads the extensions it knows and ignores any bytes after them. That keeps changes compatible in both directions: new decoders read old markers (the flag is 0, nothing follows), and decoders from before an extension still read everything else in a newer marker.

| Flag | Field | Size | Notes |
|---|---|---|---|
| 64 | bkpt | 3 × int24 | The profile's measured black point (`bkpt` tag), raw s15Fixed16, copied exactly. Left out when the profile has none or it is all zeros. |

Adding an extension this way keeps the format at version 1. Bump the format byte only for a change that older decoders would misread.

## Curves

Each curve starts with a kind byte:

| Kind | Body | Exact? |
|---|---|---|
| 0 identity | none | yes |
| 1 gamma | u16, u8Fixed8 gamma as in a 1-entry `curv` | yes |
| 2 parametric | u8 ICC function type (0–4), then 1, 3, 4, 5 or 7 × int24 raw s15Fixed16 parameters | yes |
| 3 sampled | u8 sample count *K*, u16 entry count of the original table, u16 gamma × 1000, then *K* zigzag varints | no, see below |

Formula curves (gamma and parametric, which DisplayCAL and ArgyllCMS often write) are copied exactly. Measured table curves (i1Profiler and many others) are resampled:

- *K* points are taken evenly across the input range (17, 33 or 65, chosen on the page; 33 by default). A table with no more than *K* entries keeps all of its entries.
- To spend precision where the eye needs it, each value *y* is stored as *t* = round(*y*^(1/γ) × 65535), where γ is the curve's own effective gamma at 50% input, clamped to 0.5–4 (γ = 1 for vcgt curves, which are close to straight lines).
- The *t* values are written as zigzag varints: *t*₀, then *t*₁ − *t*₀, then second differences. Smooth curves make these numbers tiny, which is what DEFLATE then squeezes.
- When decoding, the points are interpolated with a monotone cubic (Fritsch–Carlson), so the rebuilt curve can't overshoot or reverse.

The "Match to file" readout on the page is the largest difference between the original table and the rebuilt curve, in 8-bit code steps. It measures how faithfully the marker copies the file, not how accurate the display is. At 33 points, measured curves land well under one step.

## What a marker does not carry

LUT tags (`A2B*`, `B2A*`), measurement and metadata tags, and the profile ID. Profiles that have only LUTs are refused with an explanation. Profiles that have both a matrix/shaper and LUTs keep their matrix/shaper part, which is what most systems use for a display. A video card curve that is a straight line (an uncalibrated display) is left out.

## Rebuilding the ICC file

`buildICC()` writes a display-class (`mntr`) RGB profile with an XYZ connection space and a D50 illuminant, in the source's ICC version:

- `desc` (a v2 `desc` with an ASCII and a Unicode part, or a v4 `mluc`), and a `cprt` saying it was rebuilt from a marker.
- `wtpt`, `rXYZ`, `gXYZ`, `bXYZ`, and `chad` when present, all copied exactly.
- `rTRC`, `gTRC`, `bTRC`. When all three are identical they share one tag. Sampled curves are written back at their original table length.
- `lumi` and `bkpt`, when present.
- `vcgt`: a formula stays a formula. Curves are written as a 3-channel, 16-bit table with at least 256 and at most 1024 entries.

Tags are 4-byte aligned and the header size matches the file length. The tests check this for every profile.

## The printed marker

`makeMarker()` draws the marker as SVG, in units of QR modules, with its physical width and height set in millimetres (0.5 mm per module by default). From top to bottom:

- the title "ICCQR Calibration Marker", whose ink spans exactly the width of the code;
- the code with its 4-module quiet zone;
- the date, large, in IBM Plex Mono Bold;
- the note, one line of up to 36 characters.

The title and date are drawn as outlines from `lib/glyphs.json`, so the marker looks the same in any browser, editor or print shop. `scripts/glyphs.py` regenerates them. Only the note is live text, in a monospace font stack, squeezed with `textLength` if a fallback font runs wide.

The QR code holds two segments: the decoder address plus `#` in byte mode, and the payload in alphanumeric mode. qrcode-generator picks the smallest version that fits. Error correction is Q (25%) by default.

## Black level and contrast ratio

`blackLevel()` gives black relative to white from the measured black point when the profile has one, or else from the tone curves' output at input 0, weighted by the primaries' luminance. With the white luminance (`lumi`) it also gives black in cd/m²; the contrast ratio needs only the relative value. `summarize()` labels a value worked out from the tone curves as such, and reports "not recorded" for profiles that draw their curves down to zero and record no black point.

## Rules for changing the format

- **Never change how format 1 decodes.** `test/golden-v1.txt` holds a payload from the first release, and the tests that decode it and re-encode it to the same bytes must keep passing unchanged.
- **Add optional fields as extensions**: a new flag bit, and the field appended after the existing ones. Decoders ignore trailing bytes they don't know, so markers stay readable in both directions.
- **Bump the format byte only for a change older decoders would misread**, and add a new decoding branch with format 1 kept as it is.
- **Keep the payload in the base32 alphabet**, so the QR code can stay in alphanumeric mode.
- **The decoder address is printed on every marker.** Whoever hosts a decoder (for the default, `https://iccqr.github.io/`) has to keep it reachable for as long as the markers are in use.
