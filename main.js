const videoElement = document.querySelector(".input_video");
const canvasElement = document.querySelector(".output_canvas");
const canvasCtx = canvasElement.getContext("2d");
const statusDiv = document.getElementById("status");
const logContainer = document.getElementById("log-container");

// Import audio files
import wink1Url from "./wink1.mp3";
import wink2Url from "./wink2.mp3";

// Sound effects
const winkSounds = [new Audio(wink1Url), new Audio(wink2Url)];
let winkSoundIndex = 0;

let drawLandmarksEnabled = false;
const debugButton = document.createElement("button");
debugButton.textContent = "Toggle Debug View";
debugButton.style.marginBottom = "10px";
debugButton.onclick = () => {
  drawLandmarksEnabled = !drawLandmarksEnabled;
};
document.body.insertBefore(debugButton, document.getElementById("status"));

// Eye tracking
let lastLeftEyeOpen = true;
let lastRightEyeOpen = true;
let lastBlinkTime = 0;
const BLINK_EAR_THRESHOLD = 0.15;
const BLINK_INTERVAL = 100;

// Eye indices
const LEFT_EYE = [33, 160, 158, 133, 153, 144];
const RIGHT_EYE = [362, 385, 387, 263, 373, 380];

function calculateEAR(landmarks, indices) {
  const [p1, p2, p3, p4, p5, p6] = indices.map((i) => landmarks[i]);
  const vertical1 = Math.hypot(p2.x - p6.x, p2.y - p6.y);
  const vertical2 = Math.hypot(p3.x - p5.x, p3.y - p5.y);
  const horizontal = Math.hypot(p1.x - p4.x, p1.y - p4.y);
  return (vertical1 + vertical2) / (2.0 * horizontal);
}

function calculate3DEAR(landmarks, indices) {
  const [p1, p2, p3, p4, p5, p6] = indices.map((i) => landmarks[i]);
  function dist3(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  }
  const vertical1 = dist3(p2, p6);
  const vertical2 = dist3(p3, p5);
  const horizontal = dist3(p1, p4);
  return (vertical1 + vertical2) / (2.0 * horizontal);
}

function onResults(results) {
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(
    results.image,
    0,
    0,
    canvasElement.width,
    canvasElement.height
  );

  if (results.multiFaceLandmarks.length > 0) {
    const now = Date.now();
    const landmarks = results.multiFaceLandmarks[0];

    const leftEAR = calculate3DEAR(landmarks, LEFT_EYE);
    const rightEAR = calculate3DEAR(landmarks, RIGHT_EYE);

    const leftEyeOpen = leftEAR > BLINK_EAR_THRESHOLD;
    const rightEyeOpen = rightEAR > BLINK_EAR_THRESHOLD;

    if (
      lastLeftEyeOpen &&
      lastRightEyeOpen &&
      !leftEyeOpen &&
      !rightEyeOpen &&
      now - lastBlinkTime > BLINK_INTERVAL
    ) {
      lastBlinkTime = now;
      const sound = winkSounds[winkSoundIndex];
      sound.currentTime = 0;
      sound.play();
      winkSoundIndex = (winkSoundIndex + 1) % winkSounds.length;

      const logEntry = document.createElement("div");
      logEntry.className = "blink-log";
      logEntry.innerHTML = `<span class="eye-left">👁 Left</span> & <span class="eye-right">Right 👁</span> blinked!`;
      logContainer.appendChild(logEntry);
      logContainer.scrollTop = logContainer.scrollHeight;
    }

    lastLeftEyeOpen = leftEyeOpen;
    lastRightEyeOpen = rightEyeOpen;

    if (drawLandmarksEnabled) {
      drawConnectors(canvasCtx, landmarks, FACEMESH_TESSELATION, {
        color: "#C0C0C0",
        lineWidth: 1,
      });
      drawLandmarks(canvasCtx, landmarks, { color: "#FF3030", radius: 1 });
    }
  }

  canvasCtx.restore();
}

// Set up FaceMesh
const faceMesh = new FaceMesh({
  locateFile: (file) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
});
faceMesh.setOptions({
  maxNumFaces: 1,
  refineLandmarks: true,
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5,
});
faceMesh.onResults(onResults);

statusDiv.textContent = "Starting camera...";

// Set up camera
const camera = new Camera(videoElement, {
  onFrame: async () => {
    await faceMesh.send({ image: videoElement });
  },
  width: 640,
  height: 480,
});
camera.start();
