import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { midiToNotes } from "../music-audio.ts";

const abcjs = createRequire(import.meta.url)("abcjs");

// Verifies REQ-038 (UC-06)
test("midiToNotes reads the notes abcjs writes for a tune", () => {
  const midi = abcjs.synth.getMidiFile("X:1\nM:4/4\nL:1/4\nK:C\nCDEF|GABc|", { midiOutputType: "binary" })[0];
  const notes = midiToNotes(midi);
  assert.deepEqual(notes.map((n) => n.pitch), [60, 62, 64, 65, 67, 69, 71, 72]);
  // Even quarter notes, in time order, each with a length.
  const gaps = notes.slice(1).map((n, i) => +(n.start - notes[i].start).toFixed(3));
  assert.ok(gaps.every((g) => g > 0 && Math.abs(g - gaps[0]) < 1e-6), JSON.stringify(gaps));
  assert.ok(notes.every((n) => n.dur > 0));
});

// Verifies REQ-038 (UC-06)
test("midiToNotes follows repeats and ignores garbage", () => {
  const once = midiToNotes(abcjs.synth.getMidiFile("X:1\nL:1/4\nK:C\nCDEF|", { midiOutputType: "binary" })[0]);
  const twice = midiToNotes(abcjs.synth.getMidiFile("X:1\nL:1/4\nK:C\n|:CDEF:|", { midiOutputType: "binary" })[0]);
  assert.equal(twice.length, once.length * 2);
  assert.deepEqual(midiToNotes(new Uint8Array([1, 2, 3, 4, 5])), []);
});
