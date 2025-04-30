# Wink Sound Effects

A simple web application that uses MediaPipe to detect blinks and play a sound effect when a blink is detected.

## Features

- Webcam-based face detection
- Plays a sound when you blink
- Uses MediaPipe Face Mesh for accurate eye tracking
- Visual display of face mesh landmarks
- Real-time blink event logging with EAR values

## Setup

1. Make sure you have [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/) installed.

2. Install dependencies:

   ```
   pnpm install
   ```

3. Start the development server:

   ```
   pnpm start
   ```

4. Open your browser to the URL displayed in the terminal (usually http://localhost:5173)

## Usage

- Allow camera access when prompted
- Look into the camera
- Blink to hear the sound effect
