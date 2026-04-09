export type EventKind = "blink" | "left-wink" | "right-wink" | "tracking" | "system";

export type CameraStatus =
  | "idle"
  | "requesting"
  | "active"
  | "paused"
  | "permission-denied"
  | "unavailable"
  | "error";

export type PermissionStatus = "unknown" | "requesting" | "granted" | "denied" | "unavailable";

export type CameraPhase =
  | { kind: "idle" }
  | { kind: "requesting" }
  | { kind: "active"; frameRate: number | null }
  | { kind: "paused" }
  | { kind: "permission-denied"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "error"; message: string };

export type EventGateState =
  | { kind: "armed" }
  | { kind: "blocked"; lastEventAt: number; reason: "fresh-closure" | "cooldown" | "stale" };

export type SoundPackId = "arcade" | "soft" | "sci-fi";

export type ToyModeId = "blink-jazz" | "challenge" | "streamer" | "meditation";

export interface AppSettings {
  soundPack: SoundPackId;
  toyMode: ToyModeId;
  sensitivity: number;
  cooldown: number;
  volume: number;
  mirror: boolean;
  debug: boolean;
  mute: boolean;
  calibration: {
    left: number | null;
    right: number | null;
  };
}

export interface FrameMetrics {
  timestamp: number;
  leftEar: number;
  rightEar: number;
  leftOpen: boolean;
  rightOpen: boolean;
  candidate: EventKind | null;
  freshClosure: boolean;
  armed: boolean;
}

export interface EventRecord {
  kind: EventKind;
  title: string;
  detail: string;
  timestamp: number;
}

export interface SoundClip {
  id: string;
  kind: EventKind;
  pack: SoundPackId;
  src: string;
  durationMs: number;
}

export interface SoundPlaybackRequest {
  kind: EventKind;
  now: number;
  triggerAt: number;
  maxAgeMs?: number;
}

export interface SoundPlaybackDecision {
  clip: SoundClip | null;
  reason: "ok" | "too-late" | "duplicate" | "missing";
  triggerToPlayMs: number | null;
}
