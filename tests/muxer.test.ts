import { it, expect } from 'vitest'
import { Muxer, ArrayBufferTarget } from 'mp4-muxer'
it('writes MP4 moov, avcC, timing and sample table boxes', () => {
  const target = new ArrayBufferTarget()
  const muxer = new Muxer({ target, video: { codec: 'avc', width: 320, height: 240 }, fastStart: false })
  const description = new Uint8Array([1, 0x42, 0, 0x1f, 0xff, 0xe1, 0, 10, 0x67, 0x42, 0, 0x1f, 0xe5, 0x88, 0x68, 0x54, 0x05, 0x01, 1, 0, 4, 0x68, 0xce, 0x06, 0xe2])
  muxer.addVideoChunkRaw(new Uint8Array([0, 0, 0, 2, 0x65, 0x88]), 'key', 0, 250000, { decoderConfig: { codec: 'avc1.42001f', codedWidth: 320, codedHeight: 240, description } })
  muxer.finalize()
  const bytes = new Uint8Array(target.buffer); const text = new TextDecoder('latin1').decode(bytes)
  for (const box of ['ftyp', 'mdat', 'moov', 'avcC', 'stts', 'stsz', 'stco']) expect(text).toContain(box)
  expect(bytes.length).toBeGreaterThan(100)
})
