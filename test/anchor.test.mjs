import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import test from 'node:test'
import { decodePng, encodeGrayPng, cropPng, cropGray } from '../lib/png.mjs'
import { matchAnchor, anchorFromScreenshot, syntheticPng } from '../lib/anchor.mjs'

const CRC = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1)
    t[n] = c
  }
  return (buf) => {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = t[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
})()

function chunk(type, data) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const body = Buffer.concat([head.subarray(4), data])
  const tail = Buffer.alloc(4)
  tail.writeUInt32BE(CRC(body), 0)
  return Buffer.concat([head.subarray(0, 4), body, tail])
}

// 用指定 filter 编码灰度图：验证解码器能还原真实 PNG 常用的 1/2/3/4 号 filter
function pngWithFilter(width, height, gray, colorType = 0, channels = 1, filterOf = () => 0) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = colorType
  const stride = width * channels
  const raw = Buffer.alloc((stride + 1) * height)
  const plain = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = filterOf(y)
    raw[y * (stride + 1)] = filter
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < channels; c++) {
        const value = gray[(y * width + x) * channels + c]
        plain[y * stride + x * channels + c] = value
        const a = x >= 1 ? plain[y * stride + (x - 1) * channels + c] : 0
        const b = y >= 1 ? plain[(y - 1) * stride + x * channels + c] : 0
        const cc = (x >= 1 && y >= 1) ? plain[(y - 1) * stride + (x - 1) * channels + c] : 0
        let v = value
        if (filter === 1) v = (value - a) & 0xff
        else if (filter === 2) v = (value - b) & 0xff
        else if (filter === 3) v = (value - ((a + b) >> 1)) & 0xff
        else if (filter === 4) {
          const p = a + b - cc
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc)
          const pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc
          v = (value - pred) & 0xff
        }
        raw[y * (stride + 1) + 1 + x * channels + c] = v
      }
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ])
}

function button(x, y, scale = 1) {
  const w = Math.round(80 * scale), h = Math.round(34 * scale)
  return (px, py) => {
    const dx = px - x, dy = py - y
    if (dx >= 0 && dx < w && dy >= 0 && dy < h) {
      if (dx < 3 || dy < 3 || dx > w - 4 || dy > h - 4) return 30
      return (dx % 7 < 3) ? 60 : 190
    }
    return 235
  }
}

test('PNG 编解码往返：灰度图、边界像素与裁切夹紧', () => {
  const png = encodeGrayPng(24, 12, Uint8Array.from({ length: 24 * 12 }, (_, i) => i % 256))
  const decoded = decodePng(png)
  assert.equal(decoded.width, 24)
  assert.equal(decoded.height, 12)
  assert.equal(decoded.gray[0], 0)
  assert.equal(decoded.gray[25], 25)
  const cropped = cropPng(png, { x: 20, y: 8, w: 20, h: 20 }, 8)
  assert.equal(cropped.width, 12, '越界要夹紧到图像边缘')
  assert.equal(cropped.height, 12)
  const edge = cropGray({ width: 10, height: 10, gray: new Uint8Array(100).fill(7) }, { x: -20, y: -20, w: 5, h: 5 }, 8)
  assert.equal(edge.offset.x, 0)
  assert.equal(edge.offset.y, 0)
})

test('PNG 解码支持真实截图会用的 filter 1/2/3/4 与 RGBA 四通道', () => {
  const w = 32, h = 16
  const gray = new Uint8Array(w * h)
  for (let i = 0; i < gray.length; i++) gray[i] = (i * 37 + (i % w) * 11) % 256
  for (let filter = 0; filter <= 4; filter++) {
    const png = pngWithFilter(w, h, gray, 0, 1, () => filter)
    const decoded = decodePng(png)
    assert.deepEqual([...decoded.gray], [...gray], `filter ${filter} 解码不一致`)
  }
  // RGBA：灰度换算 0.299R + 0.587G + 0.114B
  const rgba = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = 200; rgba[i * 4 + 1] = 100; rgba[i * 4 + 2] = 50; rgba[i * 4 + 3] = 255
  }
  const decoded = decodePng(pngWithFilter(w, h, rgba, 6, 4, () => 0))
  assert.equal(decoded.width, w)
  assert.equal(decoded.gray[0], Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 50))
  assert.throws(() => decodePng(Buffer.from('not png')), /不是有效的 PNG/)
})

test('L3 锚点：控件平移后仍能命中，坐标精确', () => {
  const first = syntheticPng(360, 220, button(60, 40))
  const second = syntheticPng(360, 220, button(210, 120))
  const anchor = anchorFromScreenshot(first, { x: 60, y: 40, w: 80, h: 34 }, 8)
  assert.equal(anchor.width, 96)
  assert.equal(anchor.height, 50)
  const hit = matchAnchor(second, anchor.png)
  assert.ok(hit, '应命中')
  assert.ok(Math.abs(hit.x - 202) <= 3, `x=${hit.x} 应接近 202`)
  assert.ok(Math.abs(hit.y - 112) <= 3, `y=${hit.y} 应接近 112`)
  assert.ok(hit.score >= 0.86)
  assert.match(hit.note, /兜底参考/)
})

// 真实 DPI 缩放是「整张界面连纹理一起放大」，不是把按钮画大却保持条纹周期不变。
// 旧用例用 button(x,y,1.25) 只放大 w/h、dx%7 周期不变，物理上不是缩放；
// 换成整图重采样后才与真实 GUI 一致（见 temp/gui/gui-verify-result.json）。
function scaledWholeImage(pngBuffer, factor) {
  const src = decodePng(pngBuffer)
  const w = Math.round(src.width * factor), h = Math.round(src.height * factor)
  const gray = new Uint8Array(w * h)
  for (let y = 0; y < h; y += 1) {
    const sy = Math.min(src.height - 1, Math.floor(y / factor))
    for (let x = 0; x < w; x += 1) {
      gray[y * w + x] = src.gray[sy * src.width + Math.min(src.width - 1, Math.floor(x / factor))]
    }
  }
  return encodeGrayPng(w, h, gray)
}

test('L3 锚点：多尺度能cover DPI/缩放变化（整图放大 1.25 倍）', () => {
  const first = syntheticPng(288, 176, button(48, 32))
  const anchor = anchorFromScreenshot(first, { x: 48, y: 32, w: 80, h: 34 }, 8)
  const hit = matchAnchor(scaledWholeImage(first, 1.25), anchor.png)
  assert.ok(hit, '整图放大后仍应命中')
  assert.ok(Math.abs(hit.x - 50) <= 6, `x=${hit.x} 应接近 50`)
  assert.ok(Math.abs(hit.y - 30) <= 6, `y=${hit.y} 应接近 30`)
  assert.ok(hit.score >= 0.86)
})

test('L3 真实 GUI 回归：纯色 / 反色 / 重复纹理不得误报命中', () => {
  // 2026-11-10 真实 Notepad + 真实 PrintWindow PNG 实测暴露过两个缺陷：
  // 旧打分（1 - 平均绝对差/255）在纯色空白图上返回非 null、在重复工具栏纹理上把别的块判成命中。
  const first = syntheticPng(360, 220, button(60, 40))
  const anchor = anchorFromScreenshot(first, { x: 60, y: 40, w: 80, h: 34 }, 8)
  const img = decodePng(first)

  const inverted = encodeGrayPng(img.width, img.height, Uint8Array.from(img.gray, (v) => 255 - v))
  assert.equal(matchAnchor(inverted, anchor.png), null, '主题反色不得假装命中')

  // 两个一模一样的按钮 → 界面有重复纹理，指错比不指更坏，宁可降级
  const duplicate = syntheticPng(360, 220, (x, y) => {
    const b = button(210, 120)(x, y)
    return b !== 235 ? b : button(60, 40)(x, y)
  })
  assert.equal(matchAnchor(duplicate, anchor.png), null, '双峰过近必须降级')

  const blank = syntheticPng(360, 220, () => 235)
  assert.equal(matchAnchor(blank, anchor.png), null, '纯色空白图不得命中')
  assert.equal(matchAnchor(syntheticPng(360, 220, () => 0), anchor.png), null, '纯黑图不得命中')
})

test('L3 硬约束：匹配不到 / 低纹理 / 坏数据一律返回 null 以降级', () => {
  const first = syntheticPng(360, 220, button(60, 40))
  const anchor = anchorFromScreenshot(first, { x: 60, y: 40, w: 80, h: 34 }, 8)
  assert.equal(matchAnchor(syntheticPng(360, 220, () => 235), anchor.png), null, '空白图不得假装命中')
  assert.equal(matchAnchor(syntheticPng(360, 220, () => 0), anchor.png), null, '纯黑图不得假装命中')
  const flat = encodeGrayPng(40, 40, new Uint8Array(1600).fill(200))
  assert.equal(matchAnchor(first, flat), null, '低纹理模板必须放弃')
  assert.equal(matchAnchor(Buffer.from('bad'), anchor.png), null, '坏数据必须降级')
  assert.equal(matchAnchor(first, Buffer.from('bad')), null)
})
