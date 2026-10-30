import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
import { Zip, ZipPassThrough } from 'fflate'
import type { Frame } from './timeline'
import { exportPlan, timeline } from './timeline'
import { store } from './store'
export type Progress = (fraction: number) => void
export async function imageFor(frame: Frame): Promise<ImageBitmap> {
  const saved = await store.get(frame.id); if (!saved) throw new Error('Frame is missing from storage')
  return createImageBitmap(saved.blob)
}
function avcCodec(width: number, height: number): string {
  const macroblocks = Math.ceil(width / 16) * Math.ceil(height / 16)
  return macroblocks <= 3600 ? 'avc1.42001f' : macroblocks <= 8192 ? 'avc1.420028' : 'avc1.420032'
}
export async function supportedMP4(width: number, height: number): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false
  try { return (await VideoEncoder.isConfigSupported({ codec: avcCodec(width, height), width, height, bitrate: 3_000_000, framerate: 24, avc: { format: 'avc' } })).supported ?? false }
  catch { return false }
}
export async function mp4(frames: Frame[], fps: number, signal: AbortSignal, progress: Progress): Promise<Blob> {
  const { width, height } = frames[0]
  if (!await supportedMP4(width, height)) throw new Error('H.264 encoding is not supported on this device')
  const plan = exportPlan(frames, fps)
  const target = new ArrayBufferTarget()
  const muxer = new Muxer({ target, video: { codec: 'avc', width, height }, fastStart: false })
  let failure: Error | undefined
  const durations = new Map(plan.map(p => [p.timestamp, p.duration]))
  const encoder = new VideoEncoder({ output: (chunk, meta) => {
    if (signal.aborted) return
    try {
      const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes)
      muxer.addVideoChunkRaw(bytes, chunk.type, chunk.timestamp, durations.get(chunk.timestamp) ?? chunk.duration ?? Math.round(1_000_000 / fps), meta)
    } catch (e) { failure = e as Error }
  }, error: e => { failure = e } })
  encoder.configure({ codec: avcCodec(width, height), width, height, bitrate: 3_000_000, framerate: fps, avc: { format: 'avc' }, latencyMode: 'quality' })
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const ctx = canvas.getContext('2d')!
  try {
    for (let i = 0; i < frames.length; i++) {
      if (signal.aborted) throw new Error('Export cancelled')
      if (failure) throw failure
      // Keep only one decoded source and a bounded encoder queue in memory.
      if (encoder.encodeQueueSize > 2) await encoder.flush()
      const bitmap = await imageFor(frames[i]); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height); ctx.drawImage(bitmap, 0, 0, width, height); bitmap.close()
      const videoFrame = new VideoFrame(canvas, { timestamp: plan[i].timestamp, duration: plan[i].duration })
      encoder.encode(videoFrame, { keyFrame: i === 0 || i % 30 === 0 }); videoFrame.close()
      progress((i + 1) / frames.length)
    }
    await encoder.flush(); if (failure) throw failure
    if (signal.aborted) throw new Error('Export cancelled')
    muxer.finalize()
    return new Blob([target.buffer], { type: 'video/mp4' })
  } finally { encoder.close() }
}
export async function webm(frames: Frame[], fps: number, signal: AbortSignal, progress: Progress): Promise<Blob> {
  const canvas = document.createElement('canvas'); canvas.width = frames[0].width; canvas.height = frames[0].height
  const ctx = canvas.getContext('2d')!; const stream = canvas.captureStream(0)
  const track = stream.getVideoTracks()[0] as MediaStreamTrack & { requestFrame?: () => void }
  if (!track?.requestFrame) { stream.getTracks().forEach(t => t.stop()); throw new Error('Manual canvas frames are not supported in this browser') }
  const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t))
  if (!mimeType) { stream.getTracks().forEach(t => t.stop()); throw new Error('WebM recording is not supported') }
  const recorder = new MediaRecorder(stream, { mimeType }); const parts: Blob[] = []
  recorder.ondataavailable = e => { if (e.data.size) parts.push(e.data) }
  const completed = new Promise<void>((resolve, reject) => { recorder.onstop = () => resolve(); recorder.onerror = () => reject(new Error('Recording failed')) })
  const abort = () => { if (recorder.state !== 'inactive') recorder.stop() }
  signal.addEventListener('abort', abort, { once: true })
  recorder.start()
  try {
    const ticks = timeline(frames, fps).durationFrames
    let tick = 0
    for (const frame of frames) {
      if (signal.aborted) throw new Error('Export cancelled')
      const bitmap = await imageFor(frame); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close()
      for (let h = 0; h < frame.hold; h++) {
        if (signal.aborted) throw new Error('Export cancelled')
        const until = performance.now() + 1000 / fps
        track.requestFrame?.(); tick++; progress(tick / ticks)
        await new Promise(r => setTimeout(r, Math.max(0, until - performance.now())))
      }
    }
    recorder.stop(); await completed
    if (signal.aborted) throw new Error('Export cancelled')
    return new Blob(parts, { type: mimeType })
  } finally { signal.removeEventListener('abort', abort); if (recorder.state !== 'inactive') recorder.stop(); stream.getTracks().forEach(t => t.stop()) }
}
export async function framesZip(frames: Frame[], fps: number, signal: AbortSignal, progress: Progress): Promise<Blob> {
  // Stream each JPEG into the archive; only ZIP output chunks remain until the download is created.
  const parts: Uint8Array<ArrayBuffer>[] = []
  let failure: Error | undefined
  let finished!: () => void
  const done = new Promise<void>(resolve => { finished = resolve })
  const archive = new Zip((err, chunk, final) => { if (err) failure = err; if (chunk.length) parts.push(chunk); if (final || err) finished() })
  try {
    for (let i = 0; i < frames.length; i++) {
      if (signal.aborted) throw new Error('Export cancelled')
      const saved = await store.get(frames[i].id); if (!saved) throw new Error('Frame is missing from storage')
      const entry = new ZipPassThrough(`frame_${String(i + 1).padStart(4, '0')}_hold${frames[i].hold}.jpg`)
      archive.add(entry); entry.push(new Uint8Array(await saved.blob.arrayBuffer()), true)
      progress((i + 1) / frames.length)
    }
    const entry = new ZipPassThrough('timeline.txt'); archive.add(entry)
    entry.push(new TextEncoder().encode(`Stopmo timeline\nfps: ${fps}\nframes: ${frames.length}\nduration: ${timeline(frames, fps).durationSeconds.toFixed(1)} s\n\n${frames.map((f, i) => `${i + 1}: hold ${f.hold}`).join('\n')}\n`), true)
    archive.end(); await done
    if (failure) throw failure
    if (signal.aborted) throw new Error('Export cancelled')
    return new Blob(parts, { type: 'application/zip' })
  } catch (e) { archive.terminate(); throw e }
}
