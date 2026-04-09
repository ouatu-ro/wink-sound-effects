import type { EventKind, FrameMetrics } from "../types";

export const LEFT_EYE = [33, 160, 158, 133, 153, 144] as const;
export const RIGHT_EYE = [362, 385, 387, 263, 373, 380] as const;

export function calculateEar(landmarks: Array<{ x: number; y: number }>, indices: readonly number[]) {
  const [p1, p2, p3, p4, p5, p6] = indices.map((index) => landmarks[index]);
  const vertical1 = Math.hypot(p2.x - p6.x, p2.y - p6.y);
  const vertical2 = Math.hypot(p3.x - p5.x, p3.y - p5.y);
  const horizontal = Math.hypot(p1.x - p4.x, p1.y - p4.y);
  return (vertical1 + vertical2) / (2 * horizontal);
}

export function classifyEvent(leftOpen: boolean, rightOpen: boolean): EventKind | null {
  if (!leftOpen && !rightOpen) return "blink";
  if (!leftOpen) return "left-wink";
  if (!rightOpen) return "right-wink";
  return null;
}

export function isFreshClosure(
  previousLeftOpen: boolean,
  previousRightOpen: boolean,
  leftOpen: boolean,
  rightOpen: boolean
) {
  return previousLeftOpen && previousRightOpen && (!leftOpen || !rightOpen);
}

export function canTriggerEvent(now: number, lastEventAt: number, cooldownMs: number, minGapMs = 200) {
  return now - lastEventAt >= Math.max(cooldownMs, minGapMs);
}

export function formatEar(value: number) {
  return value.toFixed(2);
}

export function createFrameMetrics(input: {
  timestamp: number;
  leftEar: number;
  rightEar: number;
  leftOpen: boolean;
  rightOpen: boolean;
  previousLeftOpen: boolean;
  previousRightOpen: boolean;
  armed: boolean;
}): FrameMetrics {
  return {
    timestamp: input.timestamp,
    leftEar: input.leftEar,
    rightEar: input.rightEar,
    leftOpen: input.leftOpen,
    rightOpen: input.rightOpen,
    candidate: classifyEvent(input.leftOpen, input.rightOpen),
    freshClosure: isFreshClosure(
      input.previousLeftOpen,
      input.previousRightOpen,
      input.leftOpen,
      input.rightOpen
    ),
    armed: input.armed,
  };
}
