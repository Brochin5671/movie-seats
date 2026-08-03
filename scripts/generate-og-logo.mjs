/**
 * @fileoverview Renders public/og-logo.png from the palette and the site tagline
 *
 * A script rather than a one-off edit, because the tagline lives in `site-config.ts` and
 * the image would otherwise drift from it silently: nothing renders this file, so a stale
 * one is only ever noticed by someone sharing a link. Reading the tagline rather than
 * repeating it is what keeps them together; nothing re-runs this, so after changing the
 * tagline, run it
 *
 * The text is not Chillax. `sharp` resolves fonts through fontconfig, so a self-hosted
 * woff2 is unreachable and the output would differ per machine; a generic bold sans keeps
 * it reproducible. The PNG is committed, so this runs only when something changes
 *
 * Run with: pnpm generate:og
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Read rather than imported: site-config.ts is TypeScript with `@/` aliases, and pulling
// a build step in here to learn one string is not worth it
const config = readFileSync(resolve(root, "src/lib/site-config.ts"), "utf8");
const tagline = config.match(/tagline:\s*"([^"]+)"/)?.[1];
const siteName = config.match(/name:\s*"([^"]+)"/)?.[1];
if (!tagline || !siteName) {
  throw new Error("could not read `name` or `tagline` from site-config.ts");
}

/* Straight from `--cinema-*` in global.css. The ink field is the whole card: the tan strip
   that used to run across the top read as a rendering artefact rather than a brand mark */
const INK = "#270e0e";
const PARCHMENT = "#f5e3be";
const TAN = "#cb8e4a";

const WIDTH = 1200;
const HEIGHT = 630;

// lucide `armchair`, the same four paths the favicon and the seat map draw
const ARMCHAIR = [
  "M19 9V6a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3",
  "M3 16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v1.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5V11a2 2 0 0 0-4 0z",
  "M5 18v2",
  "M19 18v2",
];

/*
 * The stack is centred as one block, rather than each piece being placed by eye
 *
 * Laid out from a running offset and then shifted so the block's midpoint lands on the
 * canvas midpoint. Positioning the three by hand is what left the whole group sitting
 * about 58px low: each looked right against its neighbour and the set was off centre
 */
const ICON_SCALE = 10;
const ICON = 24 * ICON_SCALE;
const TITLE_SIZE = 64;
const TAGLINE_SIZE = 32;
/** Icon bottom to the title's baseline, and title baseline to the tagline's */
const TITLE_GAP = 70;
const TAGLINE_GAP = 66;
/** How far the tagline's descenders reach below its baseline, at this size */
const DESCENDER = 8;

const blockHeight = ICON + TITLE_GAP + TAGLINE_GAP + DESCENDER;
const top = (HEIGHT - blockHeight) / 2;
const titleBaseline = top + ICON + TITLE_GAP;
const taglineBaseline = titleBaseline + TAGLINE_GAP;
// The glyph is square at this scale, so centring its box centres the chair
const iconLeft = (WIDTH - ICON) / 2;

const compose = (
  shift,
) => `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${INK}"/>
  <g transform="translate(${iconLeft} ${top + shift}) scale(${ICON_SCALE})" fill="none"
     stroke="${PARCHMENT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    ${ARMCHAIR.map((d) => `<path d="${d}"/>`).join("\n    ")}
  </g>
  <text x="${WIDTH / 2}" y="${titleBaseline + shift}" text-anchor="middle" fill="${PARCHMENT}"
        font-family="DejaVu Sans, Liberation Sans, sans-serif" font-size="${TITLE_SIZE}"
        font-weight="bold">${siteName}</text>
  <text x="${WIDTH / 2}" y="${taglineBaseline + shift}" text-anchor="middle" fill="${TAN}"
        font-family="DejaVu Sans, Liberation Sans, sans-serif"
        font-size="${TAGLINE_SIZE}">${tagline}</text>
</svg>`;

/** Topmost and bottommost rows holding anything that is not the ink field */
async function inkedRows(png) {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const field = [0x27, 0x0e, 0x0e];
  let first = -1;
  let last = -1;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels;
      const distance =
        Math.abs((data[i] ?? 0) - field[0]) +
        Math.abs((data[i + 1] ?? 0) - field[1]) +
        Math.abs((data[i + 2] ?? 0) - field[2]);
      if (distance > 30) {
        if (first < 0) first = y;
        last = y;
        break;
      }
    }
  }
  return { first, last };
}

/*
 * Two passes, because the layout box is not what the eye sees
 *
 * The armchair's paths occupy 18 of the glyph's 24 units and the tagline's descenders
 * reach an unpredictable distance below its baseline, so a block centred on its nominal
 * height sits low. Rather than hardcoding those insets, the first render is measured and
 * the second is shifted by whatever it was actually out by, which stays correct if the
 * glyph or the font changes
 */
const draft = await sharp(Buffer.from(compose(0)))
  .png()
  .toBuffer();
const { first, last } = await inkedRows(draft);
const shift = Math.round(HEIGHT / 2 - (first + last) / 2);

// Checked in memory, then written. Writing first and asserting after would leave the
// committed image replaced by the bad render on the one run that catches a problem
const corrected = await sharp(Buffer.from(compose(shift)))
  .png()
  .toBuffer();
const centred = await inkedRows(corrected);
const offBy = Math.abs(HEIGHT / 2 - (centred.first + centred.last) / 2);
if (offBy > 1) throw new Error(`content is ${offBy}px off centre after correction`);

const out = resolve(root, "public/og-logo.png");
writeFileSync(out, corrected);

console.log(`wrote ${out} (${WIDTH}x${HEIGHT}), shifted ${shift}px, tagline "${tagline}"`);
