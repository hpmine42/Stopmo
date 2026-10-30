export async function capture(video: HTMLVideoElement): Promise<{ blob: Blob; thumb: Blob; width: number; height: number }> {
  const scale = Math.min(1, 1920 / Math.max(video.videoWidth, video.videoHeight))
  const width = Math.floor(video.videoWidth * scale / 2) * 2, height = Math.floor(video.videoHeight * scale / 2) * 2
  if (!width || !height) throw new Error('Camera is not ready')
  if (typeof Worker !== 'undefined' && typeof createImageBitmap !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    const bitmap = await createImageBitmap(video)
    const worker = new Worker(new URL('./capture.worker.ts', import.meta.url), { type: 'module' })
    try {
      return await new Promise((resolve, reject) => {
        worker.onmessage = event => event.data.error ? reject(new Error(event.data.error)) : resolve({ ...event.data, width, height })
        worker.onerror = event => reject(new Error(event.message))
        worker.postMessage({ bitmap, width, height }, [bitmap])
      })
    } finally { worker.terminate() }
  }
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  canvas.getContext('2d')!.drawImage(video, 0, 0, width, height)
  const toBlob = (c: HTMLCanvasElement, quality: number) => new Promise<Blob>((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('JPEG encoding failed')), 'image/jpeg', quality))
  const blob = await toBlob(canvas, 0.9)
  const small = document.createElement('canvas'); small.width = 160; small.height = Math.round(height * 160 / width); small.getContext('2d')!.drawImage(canvas, 0, 0, small.width, small.height)
  return { blob, thumb: await toBlob(small, 0.7), width, height }
}
