declare const Camera: any;
declare const FaceMesh: any;
declare const FACEMESH_TESSELATION: any;
declare function drawConnectors(ctx: any, landmarks: any, connectors: any, style: any): void;
declare function drawLandmarks(ctx: any, landmarks: any, style: any): void;

interface HTMLVideoElement {
  requestVideoFrameCallback?(callback: (now: number, metadata: VideoFrameCallbackMetadata) => void): number;
  cancelVideoFrameCallback?(handle: number): void;
}

interface VideoFrameCallbackMetadata {
  mediaTime: number;
}
