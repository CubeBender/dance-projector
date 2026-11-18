'use strict';
// What is on the projection versus what the operator is preparing (decision D-13).
//
//   draft  – recomputed after every change (new DanS data, panel edit, style edit, …). Output pages show it
//            only when asked for it with ?view=draft, which the app's own preview does.
//   pushed – what OBS shows. It changes only when the operator presses "Push to projection", or on every
//            draft change when the projection is set to automatic.
//
// The pushed state is saved to disk, so restarting the app does not blank the screen or show unverified data.
const fs = require('fs');
const path = require('path');

// Parts of the output state the operator can recognise, used to say what is waiting to be pushed.
const SECTIONS = [
  { key: 'slotA', label: 'Competition / panel A', pick: (s) => s.slots?.A },
  { key: 'slotB', label: 'Competition / panel B', pick: (s) => (s.split ? s.slots?.B : null) },
  { key: 'schedule', label: 'Schedule', pick: (s) => s.schedule },
  { key: 'style', label: 'Style', pick: (s) => s.theme },
  { key: 'layout', label: 'Floor split / languages', pick: (s) => [s.split, s.language, s.event] },
];

class Projection {
  // server: OutputServer; file: where the pushed state is kept between runs
  constructor({ server, file }) {
    this.server = server;
    this.file = file;
    this.auto = false;
    this.draft = null;
    this.pushed = null;
    this.pushedAt = null;
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      this.pushed = saved.state;
      this.pushedAt = saved.pushedAt || null;
      server.publish(this.pushed, 'live');
    } catch { /* nothing pushed yet */ }
  }

  setAuto(on) { this.auto = !!on; if (this.auto && this.draft) this.push(); }

  // Called with every freshly computed output state.
  setDraft(state) {
    this.draft = state;
    this.server.publish(state, 'draft');
    if (this.auto) this.push();
  }

  // Puts the current draft on the projection. Returns false when there is nothing to push.
  push() {
    if (!this.draft) return false;
    // In automatic mode this runs every couple of seconds; only real changes count as a push.
    if (this.pushed && !this.changes().length) return false;
    this.pushed = this.draft;
    this.pushedAt = Date.now();
    this.server.publish(this.pushed, 'live');
    this.save();
    return true;
  }

  // Labels of the sections where draft and pushed differ, e.g. ['Competition / panel A', 'Style'].
  changes() {
    if (!this.draft) return [];
    if (!this.pushed) return SECTIONS.filter((s) => s.pick(this.draft) != null).map((s) => s.label);
    return SECTIONS.filter((s) => JSON.stringify(s.pick(this.draft) ?? null) !== JSON.stringify(s.pick(this.pushed) ?? null))
      .map((s) => s.label);
  }

  // File names (photos, background images) the pushed state still shows; they must not be deleted.
  referencedFiles() {
    const names = new Set();
    const text = JSON.stringify(this.pushed || {});
    for (const m of text.matchAll(/\/(?:photos|media)\/([^"?]+)/g)) names.add(decodeURIComponent(m[1]));
    return names;
  }

  save() {
    // Written synchronously with a temp file + rename, so a crash never leaves half a file.
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file + '.tmp', JSON.stringify({ pushedAt: this.pushedAt, state: this.pushed }));
    fs.renameSync(this.file + '.tmp', this.file);
  }
}

module.exports = { Projection };
