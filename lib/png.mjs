// 零依赖 PNG 读写：只支持教学场景会遇到的 8-bit 非隔行图（灰度/RGB/灰度+Alpha/RGBA）。
// 用途：L3 视觉锚点——从实验截图裁控件周边存成模板，UIA 读不到时做模板匹配兜底。
// 不支持调色板/隔行/16-bit；遇到就抛错，由调用方降级为整窗高亮，绝不假装匹配成功。
import { inflateSync, deflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    table[n] = c
  }
  return table
})()

function crc32(buffer) {
  let c = 0xffffffff
  for (let i = 0; i < buffer.length; i++) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const body = Buffer.concat([head.subarray(4), data])
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([head.subarray(0, 4), body, tail])
}

function paeth(a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

function channelsOf(colorType) {
  return colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 6 ? 4 : 0
}

export function decodePng(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input)
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error('不是有效的 PNG')
  let pos = 8, width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0
  const idats = []
  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos)
    const type = buffer.toString('ascii', pos + 4, pos + 8)
    const data = buffer.subarray(pos + 8, pos + 8 + length)
    if (pos + 12 + length > buffer.length) throw new Error('PNG 数据被截断')
    pos += 12 + length
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idats.push(Buffer.from(data))
    } else if (type === 'IEND') {
      break
    }
  }
  const channels = channelsOf(colorType)
  if (!width || !height || bitDepth !== 8 || !channels || interlace !== 0) {
    throw new Error(`不支持的 PNG 格式：${width}x${height} depth=${bitDepth} color=${colorType} interlace=${interlace}`)
  }
  const raw = inflateSync(Buffer.concat(idats))
  const stride = width * channels
  if (raw.length < (stride + 1) * height) throw new Error('PNG 像素数据不足')
  const pixels = Buffer.alloc(stride * height)
  let at = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[at++]
    const line = raw.subarray(at, at + stride)
    at += stride
    const cur = pixels.subarray(y * stride, (y + 1) * stride)
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0
      const b = prev ? prev[i] : 0
      const c = (prev && i >= channels) ? prev[i - channels] : 0
      let value = line[i]
      if (filter === 1) value = (value + a) & 0xff
      else if (filter === 2) value = (value + b) & 0xff
      else if (filter === 3) value = (value + ((a + b) >> 1)) & 0xff
      else if (filter === 4) value = (value + paeth(a, b, c)) & 0xff
      else if (filter !== 0) throw new Error(`不支持的 PNG filter: ${filter}`)
      cur[i] = value
    }
  }
  const gray = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < gray.length; i++, p += channels) {
    if (channels <= 2) gray[i] = pixels[p]
    else gray[i] = Math.round(0.299 * pixels[p] + 0.587 * pixels[p + 1] + 0.114 * pixels[p + 2])
  }
  return { width, height, gray }
}

export function encodeGrayPng(width, height, gray) {
  const w = Math.max(1, Math.floor(width)), h = Math.max(1, Math.floor(height))
  if (gray.length < w * h) throw new Error('灰度数据不足')
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8   // bit depth
  ihdr[9] = 0   // grayscale
  const raw = Buffer.alloc((w + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w + 1)] = 0 // filter: none
    for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = gray[y * w + x] & 0xff
  }
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// 只裁控件周边（外扩 pad），不存整窗：隐私边界。越界自动夹紧。
export function cropGray(image, rect, pad = 8) {
  const x0 = Math.max(0, Math.floor(rect.x) - pad)
  const y0 = Math.max(0, Math.floor(rect.y) - pad)
  const x1 = Math.min(image.width, Math.ceil(rect.x + rect.w) + pad)
  const y1 = Math.min(image.height, Math.ceil(rect.y + rect.h) + pad)
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0)
  const gray = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) gray[y * w + x] = image.gray[(y0 + y) * image.width + (x0 + x)]
  }
  return { width: w, height: h, gray, offset: { x: x0, y: y0 } }
}

export function cropPng(pngBuffer, rect, pad = 8) {
  const image = decodePng(pngBuffer)
  const cropped = cropGray(image, rect, pad)
  return { png: encodeGrayPng(cropped.width, cropped.height, cropped.gray), ...cropped }
}
