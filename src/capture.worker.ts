self.onmessage = async (event: MessageEvent<{ bitmap: ImageBitmap; width: number; height: number }>) => {
  const { bitmap, width, height } = event.data
  try {
    const canvas = new OffscreenCanvas(width, height); canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height); bitmap.close()
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 })
    const thumb = new OffscreenCanvas(160, Math.round(160 * height / width)); thumb.getContext('2d')!.drawImage(canvas, 0, 0, thumb.width, thumb.height)
    const small = await thumb.convertToBlob({ type: 'image/jpeg', quality: 0.7 })
    self.postMessage({ blob, thumb: small })
  } catch (error) { bitmap.close(); self.postMessage({ error: String(error) }) }
}
