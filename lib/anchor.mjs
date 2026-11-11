// L3 视觉锚点：UIA 读不到（eNSP / Qt 类）时的兜底定位。
// 纯 JS、零依赖；多尺度 + 去均值 SAD，先在低分辨率粗搜再局部精搜。
// 硬约束：匹配不到 / 图片格式不支持 / 模板纹理不足，一律返回 null，由调用方降级为整窗高亮。
import { cropPng, decodePng, encodeGrayPng } from './png.mjs'

// 实测修正（真实 GUI 验证）：DEFAULT_SCALES 原含 0.8，精搜再乘 0.97 会把模板缩到 0.776 倍，
// 在 Notepad 这种有重复工具栏纹理的真实界面上把「别的按钮」误判成命中（score 0.902）。
// 真实 DPI 常见 100% / 125% / 150%，缩小到 0.9 以下没有实际场景，收窄尺度范围。
const DEFAULT_SCALES = [0.9, 1, 1.1, 1.25, 1.5]
const DEFAULT_THRESHOLD = 0.86
const MIN_TEMPLATE_STD = 6      // 低纹理模板（纯色块）无法可靠匹配，直接放弃
const COARSE_SIDE = 480
// 候选图块方差下限（相对模板）：纯色/近似纯色区域直接拒绝。
// 真实 GUI 实测：纯色空白截图曾被旧打分误判为命中，就是这个门槛缺失。
const MIN_BLOCK_VAR_RATIO = 0.12
// 两处候选分数太接近 → 界面有重复纹理，指错按钮比不指更坏，宁可降级。
const MIN_PEAK_MARGIN = 0.03
// 粗搜只负责「提名」，下采样会让细文字的 NCC 大幅下降（真实 GUI 实测正确位置只有 0.44），
// 所以门槛必须宽松；命中与否完全由精搜 NCC ≥ threshold 判定。
const COARSE_RATIO = 0.3

function stats(gray) {
  let sum = 0, sumSq = 0
  for (let i = 0; i < gray.length; i++) { sum += gray[i]; sumSq += gray[i] * gray[i] }
  const mean = sum / gray.length
  return { mean, std: Math.sqrt(Math.max(0, sumSq / gray.length - mean * mean)) }
}

function resizeGray(image, width, height) {
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height))
  const gray = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) {
    const sy = Math.min(image.height - 1, Math.floor(y * image.height / h))
    for (let x = 0; x < w; x++) {
      const sx = Math.min(image.width - 1, Math.floor(x * image.width / w))
      gray[y * w + x] = image.gray[sy * image.width + sx]
    }
  }
  return { width: w, height: h, gray }
}

// 积分图：同时存 ΣI 与 ΣI²，方便 O(1) 拿到候选块的均值与方差。
function integralOf(image) {
  const { width: w, height: h, gray } = image
  const sum = new Float64Array((w + 1) * (h + 1))
  const sumSq = new Float64Array((w + 1) * (h + 1))
  for (let y = 1; y <= h; y++) {
    let row = 0, rowSq = 0
    for (let x = 1; x <= w; x++) {
      const v = gray[(y - 1) * w + (x - 1)]
      row += v; rowSq += v * v
      const idx = y * (w + 1) + x
      sum[idx] = sum[(y - 1) * (w + 1) + x] + row
      sumSq[idx] = sumSq[(y - 1) * (w + 1) + x] + rowSq
    }
  }
  return { sum, sumSq }
}

function areaSum(table, stride, x, y, w, h) {
  return table[(y + h) * stride + (x + w)] - table[y * stride + (x + w)]
    - table[(y + h) * stride + x] + table[y * stride + x]
}

// 归一化互相关（NCC）：score = Σ[(I-meanI)(T-meanT)] / sqrt(varI · varT)。
// 旧实现是 1 - meanDiff/255，分母固定 255，不与模板/图块能量挂钩：
//   · 纯色图块 varI=0，模板去均值后的差异被当成「小误差」→ 空白窗口误报命中；
//   · 重复纹理的相似块也能拿到 0.9 左右 → 把学生指到错按钮。
// NCC 天然把这两种情况压到接近 0，且对整体亮度偏移不敏感。
function scoreAt(image, tables, tpl, x, y, minBlockVarRatio) {
  const { width: iw, gray } = image
  const { width: tw, height: th, gray: tg } = tpl
  const stride = iw + 1
  const n = tw * th
  const sI = areaSum(tables.sum, stride, x, y, tw, th)
  const sI2 = areaSum(tables.sumSq, stride, x, y, tw, th)
  const varI = Math.max(0, sI2 - (sI * sI) / n)
  // 平坦区域不可能包含有纹理的控件，直接放弃（也避免 0/0）
  if (varI < tpl.var * minBlockVarRatio) return { score: -1 }
  const meanI = sI / n
  let cross = 0
  for (let ty = 0; ty < th; ty++) {
    const irow = (y + ty) * iw + x
    const trow = ty * tw
    for (let tx = 0; tx < tw; tx++) {
      cross += (gray[irow + tx] - meanI) * (tg[trow + tx] - tpl.mean)
    }
  }
  const denom = Math.sqrt(varI * tpl.var)
  return { score: denom > 0 ? Math.max(0, cross / denom) : -1 }
}

function templateStats(image) {
  const s = stats(image.gray)
  return { ...image, mean: s.mean, var: s.std * s.std * image.gray.length }
}

export function anchorFromScreenshot(pngBuffer, rect, pad = 8) {
  return cropPng(pngBuffer, rect, pad)
}

export function matchAnchor(windowPngBuffer, anchorPngBuffer, options = {}) {
  const scales = Array.isArray(options.scales) && options.scales.length ? options.scales : DEFAULT_SCALES
  const threshold = Number.isFinite(options.threshold) ? options.threshold : DEFAULT_THRESHOLD
  const minPeakMargin = Number.isFinite(options.minPeakMargin) ? options.minPeakMargin : MIN_PEAK_MARGIN
  const minBlockVarRatio = Number.isFinite(options.minBlockVarRatio) ? options.minBlockVarRatio : MIN_BLOCK_VAR_RATIO
  const coarseRatio = Number.isFinite(options.coarseRatio) ? options.coarseRatio : COARSE_RATIO
  let candidates = [], refinedList = []
  // diagnose:true 时返回降级原因与粗/精搜中间值，便于排查「为什么这张真实截图没命中」。
  // 正常调用仍严格返回 null，宿主据此降级为整窗高亮。
  const diag = (reason, extra = {}) => options.diagnose
    ? {
        matched: false, reason, threshold, coarseRatio, minPeakMargin, minBlockVarRatio,
        candidates: candidates.map((c) => ({ ...c })),
        refined: refinedList.slice(0, 3).map((r) => ({ score: r.score, x: r.x, y: r.y })),
        ...extra,
      }
    : null
  let windowImage, tplOriginal
  try {
    windowImage = decodePng(windowPngBuffer)
    tplOriginal = decodePng(anchorPngBuffer)
  } catch {
    return diag('png-decode-failed') // 格式不支持 → 降级
  }
  const tplStats = stats(tplOriginal.gray)
  if (tplStats.std < MIN_TEMPLATE_STD) return diag('template-low-texture', { tplStd: tplStats.std })
  if (tplOriginal.width < 8 || tplOriginal.height < 8) return diag('template-too-small')

  // 粗搜：整图下采样，模板同比缩放；步长 2
  const factor = Math.min(1, COARSE_SIDE / Math.max(windowImage.width, windowImage.height))
  const coarse = factor < 1
    ? resizeGray(windowImage, windowImage.width * factor, windowImage.height * factor)
    : windowImage
  const coarseTable = integralOf(coarse)
  const base = factor < 1
    ? resizeGray(tplOriginal, Math.max(8, tplOriginal.width * factor), Math.max(8, tplOriginal.height * factor))
    : tplOriginal

  // 粗搜只负责「提名」：真实 GUI 实测（Notepad 标题栏细文字）显示下采样会让 NCC 排序失真，
  // 正确位置常排到第 2 甚至更后。保留 6 个互不靠近的候选，逐个精搜后由精搜分数定胜负。
  const MAX_CANDIDATES = 6
  for (const scale of scales) {
    const tw = Math.max(4, Math.round(base.width * scale)), th = Math.max(4, Math.round(base.height * scale))
    if (tw >= coarse.width || th >= coarse.height) continue
    const tpl = templateStats(resizeGray(base, tw, th))
    const nearOf = (c, x, y) => !(Math.abs(c.x - x) > tw / 2 || Math.abs(c.y - y) > th / 2)
    for (let y = 0; y <= coarse.height - th; y += 2) {
      for (let x = 0; x <= coarse.width - tw; x += 2) {
        const { score } = scoreAt(coarse, coarseTable, tpl, x, y, minBlockVarRatio)
        if (score <= 0) continue
        const idx = candidates.findIndex((c) => nearOf(c, x, y))
        if (idx >= 0) {
          if (score > candidates[idx].score) candidates[idx] = { score, x, y, scale }
        } else if (candidates.length < MAX_CANDIDATES || score > candidates[candidates.length - 1].score) {
          candidates.push({ score, x, y, scale })
        } else continue
        candidates.sort((a, b) => b.score - a.score)
        candidates.length = Math.min(candidates.length, MAX_CANDIDATES)
      }
    }
  }
  // 粗搜门槛只判断「有没有值得精搜的候选」，绝不用它判定命中
  if (!candidates.length || candidates[0].score < threshold * coarseRatio) return diag('coarse-no-candidate')

  // 精搜：每个候选映射回原图，在邻域内用原尺度模板找局部最优
  const fullTable = integralOf(windowImage)
  const near = 12
  // 精搜必须枚举完整尺度集：粗搜在下采样图上会把 1:1 的模板估成 1.1（真实 GUI 实测），
  // 只试 cand.scale 附近 ±3% 会漏掉真实尺度，自匹配 NCC 掉到 0.58。
  const refineScales = [...new Set([1, ...scales])]
  for (const cand of candidates) {
    let local = null
    for (const scale of refineScales) {
      const tw = Math.max(8, Math.round(tplOriginal.width * scale))
      const th = Math.max(8, Math.round(tplOriginal.height * scale))
      if (tw >= windowImage.width || th >= windowImage.height) continue
      const tpl = templateStats(resizeGray(tplOriginal, tw, th))
      const cx = Math.round(cand.x / factor), cy = Math.round(cand.y / factor)
      const x0 = Math.max(0, cx - near), x1 = Math.min(windowImage.width - tw, cx + near)
      const y0 = Math.max(0, cy - near), y1 = Math.min(windowImage.height - th, cy + near)
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const { score } = scoreAt(windowImage, fullTable, tpl, x, y, minBlockVarRatio)
          if (score < 0) continue
          if (!local || score > local.score) local = { score, x, y, w: tw, h: th, scale }
        }
      }
    }
    if (local) refinedList.push(local)
  }
  refinedList.sort((a, b) => b.score - a.score)
  const hit = refinedList[0]
  // 两个相距足够远的候选精搜后分数仍接近 → 重复纹理，指错比不指更坏
  const second = hit && refinedList.find((r) => r !== hit
    && (Math.abs(r.x - hit.x) > hit.w / 2 || Math.abs(r.y - hit.y) > hit.h / 2))
  if (!hit || hit.score < threshold) return diag('final-score-below-threshold', { finalScore: hit ? hit.score : null })
  if (second && hit.score - second.score < minPeakMargin) {
    return diag('ambiguous-peaks', { secondScore: second.score })
  }
  return {
    matched: true,
    x: hit.x, y: hit.y, w: hit.w, h: hit.h,
    score: Number(hit.score.toFixed(4)), scale: Number(hit.scale.toFixed(3)),
    coarseScore: Number(candidates[0].score.toFixed(4)),
    candidateCount: candidates.length,
    peakMargin: second ? Number((hit.score - second.score).toFixed(4)) : null,
    note: '视觉锚点命中；DPI/主题/缩放变化可能失效，仅供兜底参考。',
  }
}

// 供测试与工具使用：造一张带纹理的灰度 PNG（不依赖任何图像库）
export function syntheticPng(width, height, painter) {
  const gray = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) gray[y * width + x] = painter ? painter(x, y) : 235
  }
  return encodeGrayPng(width, height, gray)
}
