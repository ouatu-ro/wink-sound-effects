import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import blinkAUrl from "../wink1.mp3";
import blinkBUrl from "../wink2.mp3";
import winkUrl from "../wink.mp3";
import { createSoundEngine, pickClipId } from "./audio/sound-engine";
import {
  LEFT_EYE,
  RIGHT_EYE,
  canTriggerEvent,
  calculateEar,
  createFrameMetrics,
  formatEar,
  isFreshClosure,
} from "./pipeline/blink";
import { RingBuffer } from "./pipeline/ring-buffer";
import type {
  AppSettings,
  CameraPhase,
  EventKind,
  EventRecord,
  FrameMetrics,
  SoundClip,
  SoundPackId,
  ToyModeId,
} from "./types";

const STORAGE_KEY = "wink-sound-effects:v4";
const MAX_EVENTS = 28;
const ROUND_SECONDS = 10;
const CALIBRATION_SAMPLE_COUNT = 45;
const MIN_BLINK_GAP_MS = 200;

const defaultSettings: AppSettings = {
  soundPack: "arcade",
  toyMode: "blink-jazz",
  sensitivity: 0.15,
  cooldown: 420,
  volume: 0.72,
  mirror: true,
  debug: false,
  mute: false,
  calibration: { left: null, right: null },
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultSettings);
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return {
      ...structuredClone(defaultSettings),
      ...parsed,
      calibration: {
        ...structuredClone(defaultSettings.calibration),
        ...(parsed.calibration ?? {}),
      },
    };
  } catch {
    return structuredClone(defaultSettings);
  }
}

function describeMode(mode: ToyModeId) {
  return {
    "blink-jazz": "Blink jazz",
    challenge: "Blink sprint",
    streamer: "Streamer mode",
    meditation: "Slow glow",
  }[mode];
}

function describePack(pack: SoundPackId) {
  return {
    arcade: "Retro arcade pack",
    soft: "Soft kawaii pack",
    "sci-fi": "Sci-fi scanner pack",
  }[pack];
}

function modeHintFor(mode: ToyModeId) {
  if (mode === "challenge") return "Ten seconds. Rack up as many points as you can.";
  if (mode === "streamer") return "Everything gets a little bigger and louder for demo mode.";
  if (mode === "meditation") return "Slow, calm winks create softer feedback.";
  return "Left wink, right wink, and full blink each get a slightly different response.";
}

function buildClips(): SoundClip[] {
  const durations = {
    [blinkAUrl]: 420,
    [blinkBUrl]: 560,
    [winkUrl]: 390,
  } as const;
  return [
    { id: "blink-arcade", kind: "blink", pack: "arcade", src: blinkAUrl, durationMs: durations[blinkAUrl] },
    { id: "left-arcade", kind: "left-wink", pack: "arcade", src: blinkAUrl, durationMs: durations[blinkAUrl] },
    { id: "right-arcade", kind: "right-wink", pack: "arcade", src: blinkBUrl, durationMs: durations[blinkBUrl] },
    { id: "blink-soft", kind: "blink", pack: "soft", src: winkUrl, durationMs: durations[winkUrl] },
    { id: "left-soft", kind: "left-wink", pack: "soft", src: blinkAUrl, durationMs: durations[blinkAUrl] },
    { id: "right-soft", kind: "right-wink", pack: "soft", src: blinkBUrl, durationMs: durations[blinkBUrl] },
    { id: "blink-sci-fi", kind: "blink", pack: "sci-fi", src: blinkBUrl, durationMs: durations[blinkBUrl] },
    { id: "left-sci-fi", kind: "left-wink", pack: "sci-fi", src: blinkAUrl, durationMs: durations[blinkAUrl] },
    { id: "right-sci-fi", kind: "right-wink", pack: "sci-fi", src: winkUrl, durationMs: durations[winkUrl] },
  ];
}

function clipFor(kind: EventKind, pack: SoundPackId) {
  return buildClips().find((clip) => clip.kind === kind && clip.pack === pack);
}

export default function App() {
  const [settings, setSettings] = createSignal<AppSettings>(loadSettings());
  const [statusLine, setStatusLine] = createSignal("Click Start camera to open the webcam stream.");
  const [statusText, setStatusText] = createSignal("Waiting for camera");
  const [faceText, setFaceText] = createSignal("Face not found");
  const [roundText, setRoundText] = createSignal("Round idle");
  const [sinceBlinkText, setSinceBlinkText] = createSignal("--");
  const [totalCount, setTotalCount] = createSignal(0);
  const [streakCount, setStreakCount] = createSignal(0);
  const [leftCount, setLeftCount] = createSignal(0);
  const [rightCount, setRightCount] = createSignal(0);
  const [roundScore, setRoundScore] = createSignal(0);
  const [roundRemaining, setRoundRemaining] = createSignal(ROUND_SECONDS);
  const [leftEar, setLeftEar] = createSignal(0);
  const [rightEar, setRightEar] = createSignal(0);
  const [negotiatedFps, setNegotiatedFps] = createSignal("--");
  const [observedFps, setObservedFps] = createSignal("--");
  const [events, setEvents] = createSignal<EventRecord[]>([]);
  const [running, setRunning] = createSignal(false);
  const [cameraReady, setCameraReady] = createSignal(false);
  const [faceFound, setFaceFound] = createSignal(false);
  const [cameraPhase, setCameraPhase] = createSignal<CameraPhase>({ kind: "idle" });

  let videoRef!: HTMLVideoElement;
  let canvasRef!: HTMLCanvasElement;
  let roundTimerId = 0;
  let cameraStream: MediaStream | null = null;
  let faceMesh: any;
  let lastEventAt = 0;
  let lastBlinkAt = 0;
  let blinkSoundIndex = 0;
  let roundEndsAt = 0;
  const frameBuffer = new RingBuffer<FrameMetrics>(32);
  const frameTimes = new RingBuffer<number>(30);
  const soundEngine = createSoundEngine(buildClips());
  const audioPool = new Map<string, HTMLAudioElement>();
  let videoFrameRequestId = 0;
  let usingVideoFrameCallback = false;

  const startButtonText = createMemo(() => (cameraReady() ? "Camera active" : "Start camera"));
  const pauseButtonText = createMemo(() => (running() ? "Pause" : "Resume"));
  const modeLabel = createMemo(() => `Mode: ${describeMode(settings().toyMode)}`);
  const packHint = createMemo(() => `${describePack(settings().soundPack)}. ${modeHintFor(settings().toyMode)}`);

  onMount(() => {
    console.log("[wink] boot", { settings: settings() });
    setupFaceMesh();
    syncAudioVolume();
    queueMicrotask(() => startCamera().catch(() => undefined));
  });

  onCleanup(() => {
    if (usingVideoFrameCallback && videoRef.cancelVideoFrameCallback) {
      videoRef.cancelVideoFrameCallback(videoFrameRequestId);
    } else {
      cancelAnimationFrame(videoFrameRequestId);
    }
    clearInterval(roundTimerId);
    cameraStream?.getTracks().forEach((track) => track.stop());
  });

  createEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings()));
    syncAudioVolume();
  });

  function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function syncAudioVolume() {
    const volume = settings().mute ? 0 : settings().volume;
    for (const audio of audioPool.values()) {
      audio.volume = volume;
    }
  }

  function getAudio(clipId: string, src: string) {
    let audio = audioPool.get(clipId);
    if (!audio) {
      audio = new Audio(src);
      audioPool.set(clipId, audio);
    }
    audio.volume = settings().mute ? 0 : settings().volume;
    return audio;
  }

  function addEvent(kind: EventKind, title: string, detail: string) {
    const next: EventRecord = { kind, title, detail, timestamp: Date.now() };
    setEvents((current) => [next, ...current].slice(0, MAX_EVENTS));
  }

  function measureFps(timestampMs: number) {
    frameTimes.push(timestampMs);
    const samples = frameTimes.toArray();
    if (samples.length < 2) return;
    const elapsed = samples[samples.length - 1] - samples[0];
    if (elapsed <= 0) return;
    const fps = ((samples.length - 1) * 1000) / elapsed;
    setObservedFps(fps.toFixed(1));
  }

  function renderToCanvas(image: HTMLVideoElement) {
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.clearRect(0, 0, canvasRef.width, canvasRef.height);
    if (settings().mirror) {
      ctx.translate(canvasRef.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(image, 0, 0, canvasRef.width, canvasRef.height);
    ctx.restore();
  }

  function drawHud(label: string) {
    const ctx = canvasRef.getContext("2d");
    if (!ctx) return;
    ctx.save();
    ctx.fillStyle = "rgba(7, 10, 18, 0.68)";
    ctx.strokeStyle = settings().toyMode === "streamer" ? "#ff4fd8" : "#48ffbf";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(20, 20, 220, 56, 16);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#f6f7ff";
    ctx.font = "700 19px Trebuchet MS, sans-serif";
    ctx.fillText(label, 40, 55);
    ctx.restore();
  }

  function drawFrame(results: any) {
    renderToCanvas(results.image);
    const landmarks = results.multiFaceLandmarks?.[0];
    if (!landmarks) return;
    if (settings().debug) {
      drawConnectors(canvasRef.getContext("2d"), landmarks, FACEMESH_TESSELATION, {
        color: "rgba(88, 182, 255, 0.28)",
        lineWidth: 1,
      });
      drawLandmarks(canvasRef.getContext("2d"), landmarks, { color: "#48ffbf", radius: 1 });
    }
    drawHud(running() && settings().toyMode === "challenge" ? `${roundRemaining()}s round` : "Blink orchestra");
  }

  function startFrameLoop() {
    if (usingVideoFrameCallback && videoRef.cancelVideoFrameCallback) {
      videoRef.cancelVideoFrameCallback(videoFrameRequestId);
    } else {
      cancelAnimationFrame(videoFrameRequestId);
    }
    const hasVideoFrameCallback = "requestVideoFrameCallback" in HTMLVideoElement.prototype;
    if (hasVideoFrameCallback) {
      usingVideoFrameCallback = true;
      const tick = async (_now: number, metadata: VideoFrameCallbackMetadata) => {
        if (!running()) return;
        measureFps(metadata.mediaTime * 1000);
        if (videoRef.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          try {
            await faceMesh.send({ image: videoRef });
          } catch (error) {
            console.error("[wink] faceMesh.send failed", error);
          }
        }
        videoFrameRequestId = videoRef.requestVideoFrameCallback(tick);
      };
      videoFrameRequestId = videoRef.requestVideoFrameCallback(tick);
      return;
    }
    usingVideoFrameCallback = false;

    const tick = async () => {
      if (!running()) return;
      measureFps(performance.now());
      if (videoRef.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        try {
          await faceMesh.send({ image: videoRef });
        } catch (error) {
          console.error("[wink] faceMesh.send failed", error);
        }
      }
      videoFrameRequestId = requestAnimationFrame(tick);
    };
    videoFrameRequestId = requestAnimationFrame(tick);
  }

  async function startCamera() {
    if (running()) return;
    console.log("[wink] startCamera requested");
    setStatusLine("Requesting access to your camera.");
    setCameraPhase({ kind: "requesting" });
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera APIs are not available in this browser");
      cameraStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 720 } },
      });
      videoRef.srcObject = cameraStream;
      await videoRef.play();
      const track = cameraStream.getVideoTracks()[0];
      const settings = track.getSettings();
      setNegotiatedFps(typeof settings.frameRate === "number" ? settings.frameRate.toFixed(1) : "--");
      setRunning(true);
      setCameraReady(true);
      setCameraPhase({ kind: "active", frameRate: typeof settings.frameRate === "number" ? settings.frameRate : null });
      setStatusText("Tracking faces");
      setStatusLine("Camera is live. Try a wink or a blink.");
      addEvent("system", "Camera started", "ready to catch a wink");
      startFrameLoop();
    } catch (error) {
      console.error("[wink] startCamera failed", error);
      setRunning(false);
      setCameraReady(false);
      if (error?.name === "NotAllowedError") {
        setCameraPhase({ kind: "permission-denied", message: error?.message || "permission denied" });
      } else if (error?.name === "NotFoundError" || error?.name === "NotReadableError") {
        setCameraPhase({ kind: "unavailable", message: error?.message || "camera unavailable" });
      } else {
        setCameraPhase({ kind: "error", message: error?.message || "unknown error" });
      }
      setStatusLine(`Camera failed: ${error?.message || "unknown error"}`);
      setStatusText(error?.message || "Unable to start camera");
      addEvent("system", "Camera failed", error?.message || "unknown error");
    }
  }

  function toggleRunning() {
    if (!cameraReady()) {
      startCamera();
      return;
    }
    const nextRunning = !running();
    setRunning(nextRunning);
    if (nextRunning) {
      setStatusText("Detection resumed");
      setStatusLine("Detection resumed.");
      addEvent("system", "Detection resumed", "resumed");
      setCameraPhase({
        kind: "active",
        frameRate: negotiatedFps() === "--" ? null : Number(negotiatedFps()),
      });
      startFrameLoop();
    } else {
      setStatusText("Detection paused");
      setStatusLine("Detection paused.");
      addEvent("system", "Detection paused", "paused");
      if (usingVideoFrameCallback && videoRef.cancelVideoFrameCallback) {
        videoRef.cancelVideoFrameCallback(videoFrameRequestId);
      } else {
        cancelAnimationFrame(videoFrameRequestId);
      }
      setCameraPhase({ kind: "paused" });
    }
  }

  function setupFaceMesh() {
    faceMesh = new FaceMesh({
      locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
    });
    faceMesh.setOptions({
      maxNumFaces: 1,
      refineLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    faceMesh.onResults(onResults);
  }

  function getThreshold(side: "left" | "right") {
    const base = settings().calibration[side];
    if (typeof base === "number") return Math.max(0.06, base * 0.72);
    return Math.max(0.07, settings().sensitivity - settings().sensitivity * 0.1);
  }

  function onResults(results: any) {
    drawFrame(results);
    if (!running()) return;
    const landmarks = results.multiFaceLandmarks?.[0];
    const now = Date.now();
    if (!landmarks) {
      setFaceFound(false);
      setFaceText("Tracking lost");
      setStatusText("No face found");
      addEvent("tracking", "Tracking lost", "No face in frame");
      renderStats();
      return;
    }
    setFaceFound(true);
    const left = calculateEar(landmarks, LEFT_EYE);
    const right = calculateEar(landmarks, RIGHT_EYE);
    setLeftEar(left);
    setRightEar(right);
    const previous = frameBuffer.toArray().at(-1);
    const leftOpen = left > getThreshold("left");
    const rightOpen = right > getThreshold("right");
    const candidate = createFrameMetrics({
      timestamp: now,
      leftEar: left,
      rightEar: right,
      leftOpen,
      rightOpen,
      previousLeftOpen: previous?.leftOpen ?? true,
      previousRightOpen: previous?.rightOpen ?? true,
      armed: true,
    });
    frameBuffer.push(candidate);
    if (leftOpen && rightOpen) {
      setStatusLine("Tracking faces.");
    }
    const readyForEvent =
      candidate.candidate &&
      candidate.freshClosure &&
      canTriggerEvent(now, lastEventAt, settings().cooldown, MIN_BLINK_GAP_MS);
    if (readyForEvent && candidate.candidate) {
      fireEvent(candidate.candidate, left, right, now);
    }
    setFaceText("Face found");
    setStatusText(candidate.candidate ? "Blink!" : "Tracking");
    setSinceBlinkText(lastBlinkAt ? `${Math.round((now - lastBlinkAt) / 1000)}s ago` : "--");
    if (settings().toyMode === "challenge") updateRoundTick(now);
    renderStats();
  }

  function fireEvent(kind: EventKind, left: number, right: number, now: number) {
    lastEventAt = now;
    lastBlinkAt = now;
    setTotalCount((count) => count + 1);
    setStreakCount((count) => count + 1);
    if (kind === "left-wink") setLeftCount((count) => count + 1);
    if (kind === "right-wink") setRightCount((count) => count + 1);
    if (roundActive()) {
      setRoundScore((score) => score + (kind === "blink" ? 2 : 1));
    }
    const clip = clipFor(kind, settings().soundPack);
    if (clip) {
      const playback = soundEngine.decide({
        kind,
        now,
        triggerAt: now,
        maxAgeMs: 250,
      });
      if (playback.reason === "ok") {
        const clipId = pickClipId(kind, settings().soundPack);
        const audio = getAudio(clipId, clip.src);
        soundEngine.registerPlay(clipId, now);
        console.log("[wink] playing sound", {
          kind,
          clipId,
          pack: settings().soundPack,
          delay: playback.triggerToPlayMs,
        });
        audio.currentTime = 0;
        audio.play().catch((error) => console.warn("[wink] audio play failed", error));
      } else {
        console.log("[wink] sound skipped", playback.reason);
      }
    }
    addEvent(kind, prettyLabel(kind), `L ${formatEar(left)} / R ${formatEar(right)}`);
  }

  function prettyLabel(kind: EventKind) {
    return {
      blink: "Blink",
      "left-wink": "Left wink",
      "right-wink": "Right wink",
      tracking: "Tracking",
      system: "System",
    }[kind];
  }

  function roundActive() {
    return roundRemaining() > 0;
  }

  function startRound() {
    clearInterval(roundTimerId);
    setRoundScore(0);
    roundEndsAt = Date.now() + ROUND_SECONDS * 1000;
    setRoundRemaining(ROUND_SECONDS);
    setRoundText(`Round ${ROUND_SECONDS}s`);
    addEvent("system", "Challenge started", "10 second sprint");
    setRoundText(`Round ${ROUND_SECONDS}s`);
    roundTimerId = window.setInterval(() => {
      const remaining = Math.max(0, roundEndsAt - Date.now());
      setRoundRemaining(Math.ceil(remaining / 1000));
      setRoundText(remaining > 0 ? `Round ${Math.ceil(remaining / 1000)}s` : `Score ${roundScore()}`);
      if (remaining <= 0) {
        clearInterval(roundTimerId);
        addEvent("system", "Challenge finished", `Score ${roundScore()}`);
      }
    }, 100);
  }

  function updateRoundTick(now: number) {
    const remainingMs = Math.max(0, roundEndsAt - now);
    setRoundRemaining(Math.ceil(remainingMs / 1000));
    setRoundText(remainingMs > 0 ? `Round ${Math.ceil(remainingMs / 1000)}s` : `Score ${roundScore()}`);
  }

  function renderStats() {
    setFaceText(faceFound() ? "Face found" : "Tracking lost");
  }

  function clearHistory() {
    setEvents([]);
    setStreakCount(0);
    setTotalCount(0);
    setLeftCount(0);
    setRightCount(0);
    addEvent("system", "History cleared", "cleared");
  }

  function clearFrameHistory() {
    frameBuffer.clear();
  }

  function statusSummary() {
    const phase = cameraPhase();
    switch (phase.kind) {
      case "idle":
        return "Ready to start";
      case "requesting":
        return "Requesting camera…";
      case "active":
        return phase.frameRate ? `Camera live @ ${phase.frameRate.toFixed(1)}fps` : "Camera live";
      case "paused":
        return "Paused";
      case "permission-denied":
        return "Camera blocked";
      case "unavailable":
        return "Camera unavailable";
      case "error":
        return "Camera error";
    }
  }

  const stats = createMemo(() => [
    ["Total", totalCount()],
    ["Streak", streakCount()],
    ["Round score", roundScore()],
    ["Time left", `${roundRemaining()}s`],
    ["Left winks", leftCount()],
    ["Right winks", rightCount()],
    ["Input FPS", observedFps()],
    ["Track FPS", negotiatedFps()],
  ]);

  return (
    <>
      <div class="backdrop" />
      <main class="app-shell">
        <section class="hero panel">
          <div class="hero-copy">
            <p class="eyebrow">Blink Orchestra</p>
            <h1>Wink Sound Effects</h1>
            <p class="subtitle">
              A neon webcam toy where blinks, winks, and face tracking pulses turn into sound,
              sparks, and a suspicious amount of charm.
            </p>
            <div class="hero-actions">
              <button class="primary" onClick={startCamera}>{startButtonText()}</button>
              <button class="secondary" onClick={toggleRunning} disabled={!cameraReady()}>
                {pauseButtonText()}
              </button>
              <button class="secondary" onClick={() => playTestSound()}>Test sound</button>
            </div>
            <div class="hero-chips">
              <span class="chip chip-warm">{statusSummary()}</span>
              <span class="chip">{faceText()}</span>
              <span class="chip">{modeLabel()}</span>
              <span class="chip chip-hot">{roundText()}</span>
            </div>
            <p class="status-line">{statusLine()}</p>
          </div>
        </section>

        <section class="workspace">
          <section class="stage panel">
            <div class="stage-topline">
              <div>
                <h2>Stage</h2>
                <p>Allow camera access, then wink at the camera like you mean it.</p>
              </div>
              <div class="stage-meters">
                <div class="meter-label">
                  <span>Left</span><strong>{formatEar(leftEar())}</strong>
                </div>
                <div class="meter"><span style={{ width: `${Math.min(100, (leftEar() / 0.35) * 100)}%` }} /></div>
                <div class="meter-label">
                  <span>Right</span><strong>{formatEar(rightEar())}</strong>
                </div>
                <div class="meter"><span style={{ width: `${Math.min(100, (rightEar() / 0.35) * 100)}%` }} /></div>
              </div>
            </div>
            <div class="stage-frame">
              <video ref={(el) => (videoRef = el)} class="input_video" playsinline muted />
              <canvas ref={(el) => (canvasRef = el)} class="output_canvas" width="960" height="720" />
              <div class="stage-overlay">
                <div class="event-burst" id="event-burst" />
                <div class="tracking-card">
                  <span class="tracking-label">State</span>
                  <span class="tracking-value">{statusSummary()}</span>
                </div>
                <div class="tracking-card tiny right">
                  <span class="tracking-label">Since blink</span>
                  <span class="tracking-value">{sinceBlinkText()}</span>
                </div>
              </div>
            </div>
          </section>

          <aside class="sidebar">
            <section class="panel control-panel">
              <div class="panel-heading">
                <h2>Controls</h2>
                <p>Keep it playful, keep it local.</p>
              </div>
              <div class="control-grid">
                <label class="control-row">
                  <span>Sound pack</span>
                  <select value={settings().soundPack} onChange={(e) => updateSetting("soundPack", e.currentTarget.value as SoundPackId)}>
                    <option value="arcade">Retro arcade</option>
                    <option value="soft">Soft kawaii</option>
                    <option value="sci-fi">Sci-fi scanner</option>
                  </select>
                </label>
                <label class="control-row">
                  <span>Mode</span>
                  <select value={settings().toyMode} onChange={(e) => updateSetting("toyMode", e.currentTarget.value as ToyModeId)}>
                    <option value="blink-jazz">Blink jazz</option>
                    <option value="challenge">Blink sprint</option>
                    <option value="streamer">Streamer mode</option>
                    <option value="meditation">Slow glow</option>
                  </select>
                </label>
                <label class="control-row slider-row">
                  <span>Sensitivity</span>
                  <input type="range" min="0.08" max="0.32" step="0.01" value={settings().sensitivity} onInput={(e) => updateSetting("sensitivity", Number(e.currentTarget.value))} />
                </label>
                <label class="control-row slider-row">
                  <span>Cooldown</span>
                  <input type="range" min="100" max="1200" step="50" value={settings().cooldown} onInput={(e) => updateSetting("cooldown", Number(e.currentTarget.value))} />
                </label>
                <label class="control-row slider-row">
                  <span>Volume</span>
                  <input type="range" min="0" max="1" step="0.01" value={settings().volume} onInput={(e) => updateSetting("volume", Number(e.currentTarget.value))} />
                </label>
                <label class="toggle-row">
                  <input type="checkbox" checked={settings().mirror} onChange={(e) => updateSetting("mirror", e.currentTarget.checked)} />
                  <span>Mirror preview</span>
                </label>
                <label class="toggle-row">
                  <input type="checkbox" checked={settings().debug} onChange={(e) => updateSetting("debug", e.currentTarget.checked)} />
                  <span>Show landmarks</span>
                </label>
                <label class="toggle-row">
                  <input type="checkbox" checked={settings().mute} onChange={(e) => updateSetting("mute", e.currentTarget.checked)} />
                  <span>Mute audio</span>
                </label>
              </div>
              <div class="mini-actions">
                <button class="secondary" onClick={() => startRound()}>Start 10s round</button>
                <button class="secondary" onClick={() => openCalibration()}>Calibrate eyes</button>
                <button class="secondary" onClick={clearHistory}>Clear history</button>
                <button class="secondary" onClick={clearFrameHistory}>Clear frame buffer</button>
              </div>
              <div class="hint-box">
                Camera FPS: {negotiatedFps()} negotiated, {observedFps()} observed
              </div>
              <div class="hint-box">{packHint()}</div>
            </section>

            <section class="panel stats-panel">
              <div class="panel-heading">
                <h2>Live Stats</h2>
                <p>Simple, legible feedback while you experiment.</p>
              </div>
              <div class="stats-grid">
                <For each={stats()}>
                  {([label, value]) => (
                    <div class="stat">
                      <span>{label}</span>
                      <strong>{String(value)}</strong>
                    </div>
                  )}
                </For>
              </div>
            </section>
          </aside>
        </section>

        <section class="panel feed-panel">
          <div class="panel-heading feed-heading">
            <div>
              <h2>Event Feed</h2>
              <p>Recent movement, sounds, and tracking state changes.</p>
            </div>
            <button class="secondary" onClick={clearHistory}>Clear feed</button>
          </div>
          <div class="event-feed" aria-live="polite">
            <For each={events()}>
              {(event) => (
                <article class="event-item">
                  <div class="event-topline">
                    <span class="event-kind" data-kind={event.kind}>{event.title}</span>
                    <span class="event-meta">{new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                  </div>
                  <div class="event-meta">{event.detail}</div>
                </article>
              )}
            </For>
          </div>
        </section>
      </main>
    </>
  );

  function playTestSound() {
    const clip = clipFor("blink", settings().soundPack);
    if (!clip) return;
    const audio = getAudio("test", clip.src);
    audio.currentTime = 0;
    audio.play().catch(() => undefined);
  }

  function openCalibration() {
    addEvent("system", "Calibration started", "baseline capture placeholder");
  }
}
