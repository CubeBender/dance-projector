'use strict';
// Judge gallery: everything we keep about a judge between events, keyed by their IDT (the federation id that
// DanS reports as in_authority_id).
//
// One entry in judges.json:
//   {
//     name, surname,            editable; filled from the photo file name or typed in the app
//     displayName,              optional, replaces "Name Surname" on screen (e.g. with a title "Ing.")
//     photos: [{ file, hash, crop }],   every photo we have; file is in <userData>/photos
//     main,                     file name of the portrait shown on screen
//   }
// Older entries had a single { photo, crop }; migrateEntry() turns them into the list form.
//
// Pure functions only (no files), so they can be tested from plain Node.

const IMAGE = /\.(jpe?g|png|webp)$/i;

// Reads a gallery file name. The agreed pattern is "IDT_Surname_Name[ Number].ext", e.g.
//   "10000002_Dvořák_Petr 03.jpg"          -> { idt: '10000002', surname: 'Dvořák', name: 'Petr', n: 3 }
//   "10000003_Malá Veselá_Eva.jpg"         -> surname with a space is fine (underscores separate the parts)
// Returns null for anything that doesn't match, so the import can list it as "not recognised".
function parseFileName(fileName) {
  if (!IMAGE.test(fileName)) return null;
  const base = fileName.replace(IMAGE, '').normalize('NFC').trim();
  const m = base.match(/^(\d{5,})_([^_]+)_(.+?)(?:\s+(\d{1,3}))?$/);
  if (!m) return null;
  return { idt: m[1], surname: m[2].trim(), name: m[3].trim(), n: m[4] ? Number(m[4]) : 0 };
}

// Brings an entry from any older shape to the current one. Returns a new object.
function migrateEntry(e = {}) {
  const out = { ...e };
  if (!Array.isArray(out.photos)) out.photos = [];
  if (out.photo) {
    // old single photo becomes the first gallery photo and the main one
    if (!out.photos.some((p) => p.file === out.photo)) out.photos.unshift({ file: out.photo, crop: out.crop || null });
    out.main = out.main || out.photo;
  }
  delete out.photo; delete out.crop;
  if (out.main && !out.photos.some((p) => p.file === out.main)) out.main = null;
  if (!out.main && out.photos.length) out.main = out.photos[0].file;
  return out;
}

// The portrait shown on screen: { file, crop } or null.
function mainPhoto(e) {
  if (!e?.photos?.length) return null;
  return e.photos.find((p) => p.file === e.main) || e.photos[0];
}

// Order photos of one judge by the number in the file name, so "01" is imported (and becomes main) first.
function sortForImport(files) {
  return files
    .map((f) => ({ f, info: parseFileName(f.name) }))
    .sort((a, b) => (a.info?.idt || '').localeCompare(b.info?.idt || '') || (a.info?.n || 0) - (b.info?.n || 0));
}

module.exports = { parseFileName, migrateEntry, mainPhoto, sortForImport };
