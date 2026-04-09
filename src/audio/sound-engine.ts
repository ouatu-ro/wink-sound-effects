import type {
  EventKind,
  SoundClip,
  SoundPackId,
  SoundPlaybackDecision,
  SoundPlaybackRequest,
} from "../types";

export interface SoundEngine {
  decide(request: SoundPlaybackRequest): SoundPlaybackDecision;
  registerPlay(clipId: string, now: number): void;
  lastPlayedId(): string | null;
}

export function createSoundEngine(clips: SoundClip[]): SoundEngine {
  const lastByKind = new Map<EventKind, { id: string; at: number }>();
  let lastPlayed: string | null = null;

  return {
    decide(request) {
      const clip = clips.find((candidate) => candidate.kind === request.kind);
      if (!clip) return { clip: null, reason: "missing", triggerToPlayMs: null };
      const triggerToPlayMs = request.now - request.triggerAt;
      if (request.now - request.triggerAt > (request.maxAgeMs ?? 250)) {
        return { clip, reason: "too-late", triggerToPlayMs };
      }
      const previous = lastByKind.get(request.kind);
      if (previous && previous.id === clip.id && request.now - previous.at < clip.durationMs) {
        return { clip, reason: "duplicate", triggerToPlayMs };
      }
      return { clip, reason: "ok", triggerToPlayMs };
    },
    registerPlay(clipId, now) {
      const clip = clips.find((candidate) => candidate.id === clipId);
      if (!clip) return;
      lastByKind.set(clip.kind, { id: clip.id, at: now });
      lastPlayed = clip.id;
    },
    lastPlayedId() {
      return lastPlayed;
    },
  };
}

export function pickClipId(kind: EventKind, pack: SoundPackId) {
  if (kind === "blink") return pack === "soft" ? "blink-soft" : "blink-arcade";
  if (kind === "left-wink") return `left-${pack}`;
  if (kind === "right-wink") return `right-${pack}`;
  return `${kind}-${pack}`;
}
