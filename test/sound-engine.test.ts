import test from "node:test";
import assert from "node:assert/strict";
import { createSoundEngine } from "../src/audio/sound-engine";
import type { SoundClip } from "../src/types";

const clips: SoundClip[] = [
  { id: "blink-arcade", kind: "blink", pack: "arcade", src: "blink1", durationMs: 400 },
  { id: "left-arcade", kind: "left-wink", pack: "arcade", src: "left1", durationMs: 300 },
  { id: "blink-soft", kind: "blink", pack: "soft", src: "soft1", durationMs: 390 },
  { id: "left-soft", kind: "left-wink", pack: "soft", src: "soft2", durationMs: 420 },
];

test("sound engine selects a clip when the event is fresh", () => {
  const engine = createSoundEngine(clips);
  const decision = engine.decide({ kind: "blink", now: 1000, triggerAt: 1000, maxAgeMs: 250 });
  assert.equal(decision.reason, "ok");
  assert.equal(decision.clip?.id, "blink-arcade");
});

test("sound engine rejects stale triggers", () => {
  const engine = createSoundEngine(clips);
  const decision = engine.decide({ kind: "blink", now: 1400, triggerAt: 1000, maxAgeMs: 250 });
  assert.equal(decision.reason, "too-late");
  assert.equal(decision.triggerToPlayMs, 400);
});

test("sound engine rejects duplicate playback while the clip is still active", () => {
  const engine = createSoundEngine(clips);
  const first = engine.decide({ kind: "blink", now: 1000, triggerAt: 1000, maxAgeMs: 250 });
  assert.equal(first.reason, "ok");
  engine.registerPlay(first.clip!.id, 1000);
  const duplicate = engine.decide({ kind: "blink", now: 1100, triggerAt: 1100, maxAgeMs: 250 });
  assert.equal(duplicate.reason, "duplicate");
});

test("sound engine refuses a delayed trigger after a freeze", () => {
  const engine = createSoundEngine(clips);
  const decision = engine.decide({ kind: "blink", now: 2200, triggerAt: 1000, maxAgeMs: 250 });
  assert.equal(decision.reason, "too-late");
  assert.equal(decision.clip?.id, "blink-arcade");
});

test("soft pack has distinct clips for blink and left wink", () => {
  const engine = createSoundEngine(clips);
  const blink = engine.decide({ kind: "blink", now: 1000, triggerAt: 1000, maxAgeMs: 250 });
  const left = engine.decide({ kind: "left-wink", now: 1000, triggerAt: 1000, maxAgeMs: 250 });
  assert.equal(blink.clip?.id, "blink-arcade");
  assert.equal(left.clip?.id, "left-arcade");
  assert.notEqual(clips.find((clip) => clip.id === "blink-soft")?.src, clips.find((clip) => clip.id === "left-soft")?.src);
});
