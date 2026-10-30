# Stopmo

A small, offline-first stop-motion studio for one animation at a time. No account, upload, watermark, ads, analytics, or remote assets. The app asks for camera access; if that fails, import a numbered photo sequence instead. Projects stay in IndexedDB on the device.

## Run

Node 22 or newer:

```sh
npm ci
npm run dev
npm run typecheck
npm test -- --run
npm run build
```

Open the local HTTPS/localhost site, grant camera permission, and capture a frame. The service worker precaches the application shell after the first successful load; camera permission and WebCodecs support still depend on the browser. The production base is `/Stopmo/` for GitHub Pages.

## A take in three steps

1. Keep the camera steady. The last frame overlays the live camera at 20, 40, or 60% opacity; optionally include the penultimate frame and pin a keyframe reference. Moving the subject against the ghost gives the next position a visible target.
2. Tap **Capture frame** (or press Space), or choose an interval and start the countdown. Touching a phone on a stack of books moves the lens, so timed capture keeps both hands on the set and reduces camera shake. A screen wake lock is requested when available; the UI warns when it is not.
3. Set each frame's hold (1–9), choose 6/8/12/15/24 fps, play, then export. `durationFrames = sum(hold)`, `durationSeconds = durationFrames / fps`, and each encoded frame begins at the sum of preceding holds divided by fps. Playback and MP4 export both use this timeline. A hold changes timing, not the claimed frame rate; no interpolation occurs.

Frames are JPEG blobs in IndexedDB; the strip keeps only small thumbnail object URLs. Capture transfers a snapshot bitmap to a worker with OffscreenCanvas when available; the fallback uses a canvas on the main thread. Full-resolution playback and export load one frame blob at a time. Images are capped at 1920 pixels on the long side and never enlarged. Dimensions are rounded **down** to even pixels for H.264 compatibility. All frames in a project must share one resolution. The front live preview and its ghost mirror, but stored images do not.

## Export routes

- **MP4 / H.264:** offered only if `VideoEncoder.isConfigSupported` accepts an AVC configuration at the project resolution. One sample per source frame, with timestamps and durations from the shared export plan, not real-time recording. VideoEncoder's queue is bounded by flushing when it exceeds two samples. Cancellation closes the encoder and does not return partial output. [`mp4-muxer`](https://github.com/Vanilagy/mp4-muxer) is a small, browser-native muxer for the WebCodecs chunks; it writes the ISO BMFF sample table and AVC decoder configuration without a server or WASM codec. It is superseded upstream by Mediabunny; for this single video-only track, the smaller API is sufficient. The output uses a standard `moov` box, not fragmented MP4.
- **WebM / MediaRecorder:** an explicit fallback that records a canvas in real time, requesting one frame per timeline tick. Scheduling/recorder latency can drift by one frame. It is never described as exact. If manual frame capture is not available, the app reports an error rather than silently changing formats.
- **ZIP:** JPEG files named `frame_0001_hold2.jpg`, etc., and `timeline.txt` with fps, holds and duration. Uses a streaming, uncompressed ZIP writer (JPEGs are already compressed). Available without a video encoder.

The result screen reports the route used, timeline frame count, duration, resolution, file size, measured local export time, and save/share actions. The duration is the *planned* timeline duration; MediaRecorder output may differ. The MP4 muxer is tested for `ftyp`, `mdat`, `moov`, `avcC`, `stts`, `stsz`, and `stco` boxes with a synthetic AVC sample, and the ZIP is extracted in a test. The no-network test scans application source and was deliberately tested with an injected `fetch(...)` call: it failed as expected, then the injection was removed. It is a source guard, not a proof against third-party dependency behavior.

## Verification receipt

**No export was verified on a real device.** No genuine animation, measured output-video duration, output file size, device name, or device export time is claimed. What was checked locally: timeline timing and holds (including 84 frames at 12 and 24 fps), reorder/delete undo logic, IndexedDB blob round-trip and deletion using fake-indexeddb, ZIP contents, a synthetic muxer structure, TypeScript typecheck, tests, production build, and the source no-network guard. The MP4 encoder configuration is *queried in the browser at runtime*, but an actual hardware/software VideoEncoder, playable MP4, ffprobe measurement, camera capture, mobile layout, offline reload and WebM timing were **not** verified on a real device in this environment. `ffprobe` was not available locally. A real-device playback/export check should precede reliance on the MP4 result.

## Privacy and deletion

The app makes no API requests. Project metadata and JPEG blobs live in IndexedDB; small thumbnails and at most one decoded export frame are used while working. **Clear frames** removes the stored frames but keeps a one-level in-memory undo until another destructive operation or reload. **Delete project** clears the entire frame and project stores and invalidates undo. Exports are local downloads or Web Share file transfers initiated by the user. Sharing a file to another app is a user action outside Stopmo's storage boundary.
