import test from "node:test";
import assert from "node:assert/strict";
import {
  canTriggerEvent,
  classifyEvent,
  isFreshClosure,
  prettyEventName,
} from "../blink-utils.js";

test("classifyEvent detects a full blink", () => {
  assert.equal(classifyEvent(false, false), "blink");
});

test("classifyEvent detects left and right winks", () => {
  assert.equal(classifyEvent(false, true), "left-wink");
  assert.equal(classifyEvent(true, false), "right-wink");
});

test("classifyEvent ignores open eyes", () => {
  assert.equal(classifyEvent(true, true), null);
});

test("prettyEventName returns a stable label", () => {
  assert.equal(prettyEventName("left-wink"), "Left wink");
  assert.equal(prettyEventName("system"), "System");
});

test("canTriggerEvent enforces a 200ms minimum gap", () => {
  assert.equal(canTriggerEvent(1000, 850, 100), false);
  assert.equal(canTriggerEvent(1000, 800, 100), true);
  assert.equal(canTriggerEvent(1000, 950, 420), false);
});

test("isFreshClosure only fires on a new open-to-closed transition", () => {
  assert.equal(isFreshClosure(true, true, false, true), true);
  assert.equal(isFreshClosure(true, true, false, false), true);
  assert.equal(isFreshClosure(false, true, false, true), false);
  assert.equal(isFreshClosure(true, true, true, true), false);
});
