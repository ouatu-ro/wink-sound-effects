import test from "node:test";
import assert from "node:assert/strict";
import { RingBuffer } from "../src/pipeline/ring-buffer";

test("ring buffer keeps the most recent values only", () => {
  const buffer = new RingBuffer<number>(3);
  buffer.push(1);
  buffer.push(2);
  buffer.push(3);
  buffer.push(4);
  assert.deepEqual(buffer.toArray(), [2, 3, 4]);
});
