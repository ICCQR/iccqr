'use strict';
// iccqr: ICC display profiles <-> printable QR calibration markers.
// Everyday calls: makeMarker(), readMarker(), summarize(). The codec underneath
// (parseICC, compact, encode, decode, buildICC, ...) is exported too. See README.md.
const core = require('./core.js');
const marker = require('./marker.js');
const { version } = require('../package.json');

module.exports = { version, ...marker, ...core };
