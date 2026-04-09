import "./style.css";
import blinkAUrl from "./wink1.mp3";
import blinkBUrl from "./wink2.mp3";
import {
  calculateEAR,
  canTriggerEvent,
  classifyEvent,
  isFreshClosure,
  prettyEventName,
} from "./blink-utils.js";

const STORAGE_KEY = "wink-sound-effects:v3";
const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];
const MAX_EVENTS = 28;
const ROUND_SECONDS = 10;
const CALIBRATION_SAMPLE_COUNT = 45;

const defaultSettings = {
  soundPack: "arcade",
  toyMode: "blink-jazz",
  sensitivity: 0.15,
  cooldown: 420,
  volume: 0.72,
  mirror: true,
  debug: false,
  mute: false,
  calibration: {
    left: null,
    right: null,
  },
};

const settings = loadSettings();

const state = {
  cameraReady: false,
  running: false,
  faceFound: false,
  leftOpen: true,
  rightOpen: true,
  lastDetectionAt: 0,
  lastEventAt: 0,
  lastBlinkAt: 0,
  leftEar: 0,
  rightEar: 0,
  total: 0,
  streak: 0,
  leftCount: 0,
  rightCount: 0,
  lastKind: "system",
  events: [],
  trackingState: "unknown",
  round: {
    active: false,
    endsAt: 0,
    score: 0,
    hits: 0,
  },
  calibration: {
    active: false,
    samples: [],
    progress: 0,
    done: false,
  },
  eventArmed: true,
};

const elements = {
  video: document.querySelector(".input_video"),
  canvas: document.querySelector(".output_canvas"),
  stageFrame: document.getElementById("stage-frame"),
  eventFeed: document.getElementById("event-feed"),
  eventBurst: document.getElementById("event-burst"),
  statusChip: document.getElementById("status-chip"),
  faceChip: document.getElementById("face-chip"),
  modeChip: document.getElementById("mode-chip"),
  roundChip: document.getElementById("round-chip"),
  statusLine: document.getElementById("status-line"),
  statusValue: document.getElementById("tracking-value"),
  sinceBlink: document.getElementById("since-blink"),
  permissionNote: document.getElementById("permission-note"),
  hintBox: document.getElementById("hint-box"),
  totalCount: document.getElementById("total-count"),
  streakCount: document.getElementById("streak-count"),
  leftCount: document.getElementById("left-count"),
  rightCount: document.getElementById("right-count"),
  roundScore: document.getElementById("round-score"),
  roundTime: document.getElementById("round-time"),
  leftEarText: document.getElementById("left-ear-text"),
  rightEarText: document.getElementById("right-ear-text"),
  leftEarBar: document.getElementById("left-ear-bar"),
  rightEarBar: document.getElementById("right-ear-bar"),
  startButton: document.getElementById("start-camera"),
  pauseButton: document.getElementById("pause-detection"),
  testButton: document.getElementById("test-sound"),
  clearHistoryButton: document.getElementById("clear-history"),
  clearFeedButton: document.getElementById("clear-feed"),
  calibrateButton: document.getElementById("calibrate"),
  calibrateOpenButton: document.getElementById("calibrate-open"),
  challengeButton: document.getElementById("challenge-start"),
  soundPack: document.getElementById("sound-pack"),
  toyMode: document.getElementById("toy-mode"),
  sensitivity: document.getElementById("sensitivity"),
  cooldown: document.getElementById("cooldown"),
  volume: document.getElementById("volume"),
  mirror: document.getElementById("mirror"),
  debug: document.getElementById("debug"),
  mute: document.getElementById("mute"),
  calibrationDialog: document.getElementById("calibration-dialog"),
  wizardCopy: document.getElementById("wizard-copy"),
  wizardProgressText: document.getElementById("wizard-progress-text"),
  wizardProgressBar: document.getElementById("wizard-progress-bar"),
  wizardLeft: document.getElementById("wizard-left"),
  wizardRight: document.getElementById("wizard-right"),
  wizardCapture: document.getElementById("wizard-capture"),
  wizardSave: document.getElementById("wizard-save"),
};

const canvas = elements.canvas;
const ctx = canvas.getContext("2d");

const audio = {
  blink: [new Audio(blinkAUrl), new Audio(blinkBUrl)],
  leftWink: [new Audio(blinkAUrl)],
  rightWink: [new Audio(blinkBUrl)],
};

let blinkSoundIndex = 0;
let faceMesh;
let roundTimerId;
let stream;
let frameLoopId;

hydrateSettingsUI();
syncModeCopy();
console.log("[wink] boot", { settings });
renderAll();
bindUI();
setupKeyboardShortcuts();
setupFaceMesh();
syncVolume();
updateCameraMirror();
updateStartButton();
updatePauseButton();
updateRoundUI();
updateCalibrationUI();
queueMicrotask(() => {
  if (!state.cameraReady && !state.running) {
    console.log("[wink] auto-start camera attempt");
    startCamera();
  }
});

elements.permissionNote.textContent = "Camera stays local to this browser tab.";
elements.statusChip.textContent = "Ready to start";
elements.statusValue.textContent = "Waiting for camera";
setText(elements.statusLine, "Click Start camera to open the webcam stream.");
elements.hintBox.textContent =
  "Try a left wink, a right wink, and then a full blink.";

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultSettings);
    const parsed = JSON.parse(raw);
    return {
      ...structuredClone(defaultSettings),
      ...parsed,
      calibration: {
        ...structuredClone(defaultSettings.calibration),
        ...(parsed.calibration || {}),
      },
    };
  } catch {
    return structuredClone(defaultSettings);
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

function hydrateSettingsUI() {
  elements.soundPack.value = settings.soundPack;
  elements.toyMode.value = settings.toyMode;
  elements.sensitivity.value = String(settings.sensitivity);
  elements.cooldown.value = String(settings.cooldown);
  elements.volume.value = String(settings.volume);
  elements.mirror.checked = settings.mirror;
  elements.debug.checked = settings.debug;
  elements.mute.checked = settings.mute;
}

function bindUI() {
  elements.startButton.addEventListener("click", startCamera);
  elements.pauseButton.addEventListener("click", toggleRunning);
  elements.testButton.addEventListener("click", () => playSound("blink"));
  elements.clearHistoryButton.addEventListener("click", clearHistory);
  elements.clearFeedButton.addEventListener("click", clearHistory);
  elements.calibrateButton.addEventListener("click", calibrateNow);
  elements.calibrateOpenButton.addEventListener("click", openCalibrationWizard);
  elements.challengeButton.addEventListener("click", startRound);

  elements.wizardCapture.addEventListener("click", beginCalibrationCapture);
  elements.wizardSave.addEventListener("click", saveCalibrationResult);

  elements.soundPack.addEventListener("change", (event) => {
    settings.soundPack = event.target.value;
    saveSettings();
    syncModeCopy();
  });

  elements.toyMode.addEventListener("change", (event) => {
    settings.toyMode = event.target.value;
    saveSettings();
    syncModeCopy();
    if (settings.toyMode === "challenge") startRound();
    else stopRound(false);
  });

  elements.sensitivity.addEventListener("input", (event) => {
    settings.sensitivity = Number(event.target.value);
    saveSettings();
  });

  elements.cooldown.addEventListener("input", (event) => {
    settings.cooldown = Number(event.target.value);
    saveSettings();
  });

  elements.volume.addEventListener("input", (event) => {
    settings.volume = Number(event.target.value);
    saveSettings();
    syncVolume();
  });

  elements.mirror.addEventListener("change", (event) => {
    settings.mirror = event.target.checked;
    saveSettings();
    updateCameraMirror();
  });

  elements.debug.addEventListener("change", (event) => {
    settings.debug = event.target.checked;
    saveSettings();
  });

  elements.mute.addEventListener("change", (event) => {
    settings.mute = event.target.checked;
    saveSettings();
    syncVolume();
  });
}

function setupKeyboardShortcuts() {
  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;

    if (event.code === "Space") {
      event.preventDefault();
      toggleRunning();
    } else if (event.key.toLowerCase() === "d") {
      settings.debug = !settings.debug;
      elements.debug.checked = settings.debug;
      saveSettings();
      addEvent("system", "Debug overlay toggled", { detail: settings.debug ? "on" : "off" });
    } else if (event.key.toLowerCase() === "m") {
      settings.mute = !settings.mute;
      elements.mute.checked = settings.mute;
      saveSettings();
      syncVolume();
      addEvent("system", "Audio toggled", { detail: settings.mute ? "muted" : "audible" });
    } else if (event.key.toLowerCase() === "c") {
      openCalibrationWizard();
    }
  });
}

function setupFaceMesh() {
  faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
  });
  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  faceMesh.onResults(onResults);
}

async function startCamera() {
  if (state.running) return;

  try {
    console.log("[wink] startCamera requested");
    elements.statusChip.textContent = "Requesting camera…";
    elements.statusValue.textContent = "Permission prompt pending";
    setText(elements.statusLine, "Requesting access to your camera.");
    elements.startButton.disabled = true;

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("Camera APIs are not available in this browser");
    }

    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 960 },
        height: { ideal: 720 },
      },
    });

    elements.video.srcObject = stream;
    elements.video.playsInline = true;
    elements.video.muted = true;
    await elements.video.play();

    state.running = true;
    console.log("[wink] camera stream ready", stream.getVideoTracks().map((track) => track.label));
    updatePauseButton();
    updateStartButton();
    state.cameraReady = true;
    console.log("[wink] camera live");
    elements.statusChip.textContent = "Camera live";
    elements.statusValue.textContent = "Tracking faces";
    setText(elements.statusLine, "Camera is live. Try a wink or a blink.");
    addEvent("system", "Camera started", { detail: "ready to catch a wink" });
    startFrameLoop();
  } catch (error) {
    console.error("[wink] startCamera failed", error);
    state.running = false;
    elements.startButton.disabled = false;
    elements.statusChip.textContent = "Camera error";
    elements.statusValue.textContent = error?.message || "Unable to start camera";
    setText(elements.statusLine, `Camera failed: ${error?.message || "unknown error"}`);
    elements.permissionNote.textContent =
      "If permission is blocked, allow the camera and try again.";
    addEvent("system", "Camera failed", { detail: error?.message || "unknown error" });
  }
}

function startFrameLoop() {
  cancelAnimationFrame(frameLoopId);
  const tick = async () => {
    if (!state.running) return;
    if (elements.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      try {
        await faceMesh.send({ image: elements.video });
      } catch (error) {
        console.error("[wink] faceMesh.send failed", error);
      }
    }
    frameLoopId = requestAnimationFrame(tick);
  };
  frameLoopId = requestAnimationFrame(tick);
  console.log("[wink] frame loop started");
}

function toggleRunning() {
  if (!state.cameraReady) {
    startCamera();
    return;
  }

  state.running = !state.running;
  console.log("[wink] toggleRunning", { running: state.running });
  if (state.running) {
    elements.statusChip.textContent = "Camera live";
    elements.statusValue.textContent = "Detection resumed";
    setText(elements.statusLine, "Detection resumed.");
    addEvent("system", "Detection resumed");
    startFrameLoop();
  } else {
    elements.statusChip.textContent = "Paused";
    elements.statusValue.textContent = "Detection paused";
    setText(elements.statusLine, "Detection paused.");
    addEvent("system", "Detection paused");
    cancelAnimationFrame(frameLoopId);
  }
  updatePauseButton();
  updateStartButton();
}

function updateStartButton() {
  elements.startButton.disabled = state.cameraReady && state.running;
  elements.startButton.textContent = state.cameraReady ? "Camera active" : "Start camera";
}

function updatePauseButton() {
  elements.pauseButton.disabled = !state.cameraReady;
  elements.pauseButton.textContent = state.running ? "Pause" : "Resume";
}

function updateCameraMirror() {
  elements.stageFrame.dataset.mirror = settings.mirror ? "true" : "false";
}

function syncVolume() {
  const volume = settings.mute ? 0 : settings.volume;
  Object.values(audio)
    .flat()
    .forEach((sound) => {
      sound.volume = volume;
    });
}

function syncModeCopy() {
  elements.modeChip.textContent = `Mode: ${describeMode(settings.toyMode)}`;
  const packName = describePack(settings.soundPack);
  elements.hintBox.textContent = `${packName}. ${modeHintFor(settings.toyMode)}`;
}

function describeMode(mode) {
  return {
    "blink-jazz": "Blink jazz",
    challenge: "Blink sprint",
    streamer: "Streamer mode",
    meditation: "Slow glow",
  }[mode] || "Blink jazz";
}

function describePack(pack) {
  return {
    arcade: "Retro arcade pack",
    soft: "Soft kawaii pack",
    "sci-fi": "Sci-fi scanner pack",
  }[pack] || "Retro arcade pack";
}

function modeHintFor(mode) {
  if (mode === "challenge") return "Ten seconds. Rack up as many points as you can.";
  if (mode === "streamer") return "Everything gets a little bigger and louder for demo mode.";
  if (mode === "meditation") return "Slow, calm winks create softer feedback.";
  return "Left wink, right wink, and full blink each get a slightly different response.";
}

function normalize(value, min = 0.05, max = 0.35) {
  const clamped = Math.min(max, Math.max(min, value));
  return (clamped - min) / (max - min);
}

function getThreshold(side) {
  const base = settings.calibration[side];
  if (typeof base === "number") return Math.max(0.06, base * 0.72);
  return Math.max(0.07, settings.sensitivity - settings.sensitivity * 0.1);
}

function onResults(results) {
  if (!results) {
    console.warn("[wink] onResults called without results");
    return;
  }
  drawFrame(results);
  if (!state.running) return;

  const landmarks = results.multiFaceLandmarks?.[0];
  const now = Date.now();

  if (!landmarks) {
    state.faceFound = false;
    if (state.trackingState !== "lost") {
      state.trackingState = "lost";
      addEvent("tracking", "Tracking lost", { detail: "No face in frame" });
      console.log("[wink] tracking lost");
    }
    elements.faceChip.textContent = "Tracking lost";
    elements.statusChip.textContent = "Searching";
    elements.statusValue.textContent = "No face found";
    stopCalibrationCapture(false);
    renderStats();
    renderEventFeed();
    return;
  }

  state.faceFound = true;
  if (state.trackingState !== "found") {
    state.trackingState = "found";
    addEvent("tracking", "Tracking regained", { detail: "Face detected again" });
    console.log("[wink] tracking regained");
  }
  state.lastDetectionAt = now;

  const leftEAR = calculateEAR(landmarks, LEFT_EYE);
  const rightEAR = calculateEAR(landmarks, RIGHT_EYE);
  state.leftEar = leftEAR;
  state.rightEar = rightEAR;

  if (state.calibration.active) {
    captureCalibrationSample(leftEAR, rightEAR);
  }

  const leftOpen = leftEAR > getThreshold("left");
  const rightOpen = rightEAR > getThreshold("right");
  const eventKind = classifyEvent(leftOpen, rightOpen);
  const freshClosure = isFreshClosure(state.leftOpen, state.rightOpen, leftOpen, rightOpen);
  const bothOpen = leftOpen && rightOpen;

  if (bothOpen) {
    state.eventArmed = true;
  }

  if (
    eventKind &&
    freshClosure &&
    state.eventArmed &&
    canTriggerEvent(now, state.lastEventAt, settings.cooldown, 200)
  ) {
    triggerEvent(eventKind, { leftEAR, rightEAR, now });
    state.eventArmed = false;
  }

  state.leftOpen = leftOpen;
  state.rightOpen = rightOpen;

  elements.faceChip.textContent = "Face found";
  elements.statusChip.textContent = eventKind ? "Blink!" : state.calibration.active ? "Calibrating" : "Tracking";
  elements.statusValue.textContent = eventKind ? prettyEventName(eventKind) : "Holding steady";
  elements.leftEarText.textContent = leftEAR.toFixed(2);
  elements.rightEarText.textContent = rightEAR.toFixed(2);
  elements.sinceBlink.textContent = state.lastBlinkAt ? formatElapsed(now - state.lastBlinkAt) : "--";

  if (settings.toyMode === "challenge") {
    updateRoundTick(now);
  }

  renderStats();
  renderEventFeed();
}

function triggerEvent(kind, { leftEAR, rightEAR, now }) {
  state.lastEventAt = now;
  state.lastBlinkAt = now;
  state.lastKind = kind;
  state.total += 1;
  state.streak += 1;
  if (kind === "left-wink") state.leftCount += 1;
  if (kind === "right-wink") state.rightCount += 1;

  if (state.round.active) {
    const points = kind === "blink" ? 2 : 1;
    state.round.score += points;
    state.round.hits += 1;
    updateRoundUI();
  }

  console.log("[wink] event", { kind, leftEAR, rightEAR, now });
  playSound(kind);
  pulse(kind);
  addEvent(kind, prettyEventName(kind), {
    detail: `L ${leftEAR.toFixed(2)} / R ${rightEAR.toFixed(2)}`,
  });
}

function playSound(kind) {
  if (settings.mute) return;

  const packVolume = settings.volume;
  let sound;
  if (kind === "left-wink") {
    sound = audio.leftWink[0];
  } else if (kind === "right-wink") {
    sound = audio.rightWink[0];
  } else {
    sound = audio.blink[blinkSoundIndex];
    blinkSoundIndex = (blinkSoundIndex + 1) % audio.blink.length;
  }

  sound.volume = packVolume;
  sound.currentTime = 0;
  sound.play().catch(() => {});
}

function pulse(kind) {
  const tone = {
    blink: "rgba(72, 255, 191, 0.25)",
    "left-wink": "rgba(88, 182, 255, 0.25)",
    "right-wink": "rgba(255, 79, 216, 0.25)",
  }[kind] || "rgba(255, 255, 255, 0.2)";

  elements.eventBurst.style.background = `radial-gradient(circle at center, ${tone}, transparent 42%)`;
  elements.eventBurst.classList.add("active");
  clearTimeout(pulse.timer);
  pulse.timer = setTimeout(() => elements.eventBurst.classList.remove("active"), 180);
}

function addEvent(kind, title, { detail = "" } = {}) {
  state.events.unshift({
    kind,
    title,
    detail,
    time: new Date(),
  });
  state.events = state.events.slice(0, MAX_EVENTS);
}

function clearHistory() {
  state.events = [];
  addEvent("system", "History cleared");
  state.streak = 0;
  state.total = 0;
  state.leftCount = 0;
  state.rightCount = 0;
  renderEventFeed();
  renderStats();
}

function calibrateNow() {
  openCalibrationWizard();
  beginCalibrationCapture();
}

function openCalibrationWizard() {
  console.log("[wink] calibration wizard open");
  elements.calibrationDialog.showModal();
  state.calibration.active = false;
  state.calibration.done = false;
  state.calibration.progress = 0;
  state.calibration.samples = [];
  updateCalibrationUI();
}

function beginCalibrationCapture() {
  if (!state.cameraReady) {
    elements.statusChip.textContent = "Start camera first";
    elements.statusValue.textContent = "Calibration needs a live camera feed";
    return;
  }

  console.log("[wink] calibration capture begin");
  state.calibration.active = true;
  state.calibration.done = false;
  state.calibration.progress = 0;
  state.calibration.samples = [];
  elements.wizardCopy.textContent = "Step 1: keep both eyes open and look straight at the camera.";
  elements.wizardSave.disabled = true;
  addEvent("system", "Calibration started", { detail: "collecting open-eye baseline" });
  updateCalibrationUI();
}

function captureCalibrationSample(leftEAR, rightEAR) {
  state.calibration.samples.push({ left: leftEAR, right: rightEAR });
  state.calibration.progress = Math.min(1, state.calibration.samples.length / CALIBRATION_SAMPLE_COUNT);
  if (state.calibration.samples.length >= CALIBRATION_SAMPLE_COUNT) {
    finalizeCalibrationPreview();
  }
  updateCalibrationUI(leftEAR, rightEAR);
}

function finalizeCalibrationPreview() {
  const samples = state.calibration.samples;
  const averageLeft = average(samples.map((sample) => sample.left));
  const averageRight = average(samples.map((sample) => sample.right));
  elements.wizardCopy.textContent = "Baseline captured. Save it or re-run the capture.";
  elements.wizardSave.disabled = false;
  elements.wizardLeft.textContent = averageLeft.toFixed(2);
  elements.wizardRight.textContent = averageRight.toFixed(2);
  state.calibration.done = true;
  state.calibration.active = false;
  console.log("[wink] calibration preview", { averageLeft, averageRight });
}

function saveCalibrationResult() {
  const samples = state.calibration.samples;
  if (!samples.length) return;

  const averageLeft = average(samples.map((sample) => sample.left));
  const averageRight = average(samples.map((sample) => sample.right));
  settings.calibration = { left: averageLeft, right: averageRight };
  saveSettings();
  state.calibration.done = true;
  state.calibration.active = false;
  elements.calibrationDialog.close();
  elements.statusChip.textContent = "Calibrated";
  elements.statusValue.textContent = "Open-eye baseline saved";
  console.log("[wink] calibration saved", settings.calibration);
  addEvent("system", "Calibration saved", {
    detail: `L ${averageLeft.toFixed(2)} / R ${averageRight.toFixed(2)}`,
  });
  updateCalibrationUI();
}

function stopCalibrationCapture(closeDialog) {
  if (!state.calibration.active) return;
  state.calibration.active = false;
  if (closeDialog && elements.calibrationDialog.open) elements.calibrationDialog.close();
  updateCalibrationUI();
}

function updateCalibrationUI(currentLeft, currentRight) {
  const left = currentLeft ?? state.leftEar;
  const right = currentRight ?? state.rightEar;
  elements.wizardProgressText.textContent = `${Math.round(state.calibration.progress * 100)}%`;
  elements.wizardProgressBar.style.width = `${state.calibration.progress * 100}%`;
  elements.wizardLeft.textContent = left ? left.toFixed(2) : "--";
  elements.wizardRight.textContent = right ? right.toFixed(2) : "--";
}

function startRound() {
  if (!state.cameraReady) return;

  stopRound(true);
  state.round.active = true;
  state.round.endsAt = Date.now() + ROUND_SECONDS * 1000;
  state.round.score = 0;
  state.round.hits = 0;
  elements.modeChip.textContent = "Mode: Blink sprint";
  addEvent("system", "Challenge started", { detail: "10 second sprint" });
  console.log("[wink] challenge start", { endsAt: state.round.endsAt });
  updateRoundUI();

  clearTimeout(roundTimerId);
  roundTimerId = setTimeout(() => {
    stopRound(true);
  }, ROUND_SECONDS * 1000);
}

function stopRound(showResult) {
  if (!state.round.active && !showResult) return;

  clearTimeout(roundTimerId);
  const wasActive = state.round.active;
  state.round.active = false;
  state.round.endsAt = 0;
  if (wasActive && showResult) {
    addEvent("system", "Challenge finished", {
      detail: `Score ${state.round.score} with ${state.round.hits} hits`,
    });
    console.log("[wink] challenge finished", {
      score: state.round.score,
      hits: state.round.hits,
    });
  }
  updateRoundUI();
}

function updateRoundTick(now = Date.now()) {
  if (!state.round.active) return;
  const remaining = Math.max(0, state.round.endsAt - now);
  if (remaining <= 0) {
    stopRound(true);
    return;
  }
  updateRoundUI(remaining);
}

function updateRoundUI(remainingMs = null) {
  const remaining = remainingMs ?? (state.round.active ? Math.max(0, state.round.endsAt - Date.now()) : ROUND_SECONDS * 1000);
  elements.roundScore.textContent = String(state.round.score);
  elements.roundTime.textContent = `${Math.ceil(remaining / 1000)}s`;
  elements.roundChip.textContent = state.round.active
    ? `Round ${Math.ceil(remaining / 1000)}s`
    : state.round.score > 0
      ? `Score ${state.round.score}`
      : "Round idle";
}

function renderAll() {
  renderStats();
  renderEventFeed();
}

function renderStats() {
  setText(elements.totalCount, String(state.total));
  setText(elements.streakCount, String(state.streak));
  setText(elements.leftCount, String(state.leftCount));
  setText(elements.rightCount, String(state.rightCount));
  setText(elements.leftEarText, state.leftEar.toFixed(2));
  setText(elements.rightEarText, state.rightEar.toFixed(2));
  setWidth(elements.leftEarBar, `${normalize(state.leftEar) * 100}%`);
  setWidth(elements.rightEarBar, `${normalize(state.rightEar) * 100}%`);

  const elapsed = state.lastBlinkAt ? Date.now() - state.lastBlinkAt : 0;
  setText(elements.sinceBlink, state.lastBlinkAt ? formatElapsed(elapsed) : "--");

  if (!state.faceFound && state.running) {
    setText(elements.faceChip, "Tracking lost");
  } else if (state.running) {
    setText(elements.faceChip, "Face found");
  }
}

function renderEventFeed() {
  elements.eventFeed.innerHTML = state.events
    .map(
      (event) => `
        <article class="event-item">
          <div class="event-topline">
            <span class="event-kind" data-kind="${event.kind}">${event.title}</span>
            <span class="event-meta">${formatTime(event.time)}</span>
          </div>
          <div class="event-meta">${event.detail || prettyMeta(event.kind)}</div>
        </article>
      `
    )
    .join("");
}

function prettyMeta(kind) {
  if (kind === "system") return "Status update";
  return `Recent ${prettyEventName(kind).toLowerCase()}`;
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatElapsed(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${Math.round(ms / 1000)}s ago`;
}

function drawFrame(results) {
  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (settings.mirror) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(results.image, 0, 0, canvas.width, canvas.height);

  if (results.multiFaceLandmarks?.length) {
    const landmarks = results.multiFaceLandmarks[0];
    if (settings.debug) {
      drawConnectors(ctx, landmarks, FACEMESH_TESSELATION, {
        color: "rgba(88, 182, 255, 0.28)",
        lineWidth: 1,
      });
      drawLandmarks(ctx, landmarks, { color: "#48ffbf", radius: 1 });
    }
    drawHud(landmarks);
  }

  ctx.restore();
}

function drawHud(landmarks) {
  const left = landmarks[LEFT_EYE[0]];
  const right = landmarks[RIGHT_EYE[3]];
  const width = canvas.width;
  const height = canvas.height;

  const x = ((left.x + right.x) / 2) * width;
  const y = ((left.y + right.y) / 2) * height - 60;

  ctx.save();
  ctx.fillStyle = "rgba(7, 10, 18, 0.68)";
  ctx.strokeStyle = state.round.active ? "#ff4fd8" : "#48ffbf";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x - 104, y - 22, 208, 52, 16);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "#f6f7ff";
  ctx.font = "700 19px Trebuchet MS, sans-serif";
  ctx.fillText(
    state.round.active ? `ROUND ${Math.ceil((state.round.endsAt - Date.now()) / 1000)}s` : prettyEventName(state.lastKind),
    x - 84,
    y + 10
  );
  ctx.restore();
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function setText(element, value) {
  if (!element) return;
  element.textContent = value;
}

function setWidth(element, value) {
  if (!element) return;
  element.style.width = value;
}

window.addEventListener("beforeunload", saveSettings);
