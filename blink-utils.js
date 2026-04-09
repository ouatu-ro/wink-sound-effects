export function calculateEAR(landmarks, indices) {
  const [p1, p2, p3, p4, p5, p6] = indices.map((i) => landmarks[i]);
  const vertical1 = Math.hypot(p2.x - p6.x, p2.y - p6.y);
  const vertical2 = Math.hypot(p3.x - p5.x, p3.y - p5.y);
  const horizontal = Math.hypot(p1.x - p4.x, p1.y - p4.y);
  return (vertical1 + vertical2) / (2 * horizontal);
}

export function classifyEvent(leftOpen, rightOpen) {
  if (!leftOpen && !rightOpen) return "blink";
  if (!leftOpen) return "left-wink";
  if (!rightOpen) return "right-wink";
  return null;
}

export function prettyEventName(kind) {
  return {
    blink: "Blink",
    "left-wink": "Left wink",
    "right-wink": "Right wink",
    tracking: "Tracking",
    system: "System",
  }[kind] || "Event";
}

export function canTriggerEvent(now, lastEventAt, cooldownMs, minGapMs = 200) {
  return now - lastEventAt >= Math.max(cooldownMs, minGapMs);
}

export function isFreshClosure(previousLeftOpen, previousRightOpen, leftOpen, rightOpen) {
  return previousLeftOpen && previousRightOpen && (!leftOpen || !rightOpen);
}
