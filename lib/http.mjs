import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize } from 'node:path'

export const JSON_HEADERS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
})

const MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

function isLoopbackHostname(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '')
  if (!h) return false
  if (h === 'localhost' || h.endsWith('.localhost') || h === '::1') return true
  const parts = h.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every((x) => /^\d{1,3}$/.test(x) && Number(x) <= 255)
}

export function isTrustedLocalRequest(req) {
  try {
    const headers = req?.headers || {}
    const host = new URL(`http://${String(headers.host || '')}`)
    if (!isLoopbackHostname(host.hostname)) return false
    if (String(headers['sec-fetch-site'] || '').toLowerCase() === 'cross-site') return false
    const origin = headers.origin
    if (typeof origin === 'string' && origin && origin !== 'null') {
      const parsed = new URL(origin)
      if (parsed.protocol === 'dsh-app:' || parsed.protocol === 'file:') return true
      if (parsed.host.toLowerCase() !== host.host.toLowerCase()) return false
    }
    return true
  } catch {
    return false
  }
}

export function sendJson(res, status, value) {
  res.writeHead(status, JSON_HEADERS)
  res.end(JSON.stringify(value))
}

// 带状态码的错误：调用方（三个 HTTP 入口）据此返回 4xx 而不是一律 500
function httpError(message, statusCode) {
  return Object.assign(new Error(message), { statusCode })
}

export async function readJsonBody(req, maxBytes = 64 * 1024) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw httpError(`请求体过大（上限 ${Math.round(maxBytes / 1024)} KB）`, 413)
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  let value
  try {
    value = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw httpError('请求体不是有效 JSON', 400)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw httpError('请求体必须是 JSON 对象', 400)
  return value
}

export function serveFile(res, filePath) {
  if (!existsSync(filePath)) {
    sendJson(res, 404, { ok: false, error: '文件不存在' })
    return
  }
  const st = statSync(filePath)
  if (!st.isFile()) {
    sendJson(res, 404, { ok: false, error: '文件不存在' })
    return
  }
  const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream'
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': String(st.size),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  createReadStream(filePath).pipe(res)
}

export function resolveContainedFile(baseDir, requested) {
  const safeName = String(requested || '').replace(/\\/g, '/').split('/').pop() || ''
  if (!/^[A-Za-z0-9._-]+$/.test(safeName)) return null
  const base = normalize(baseDir)
  const full = normalize(join(baseDir, safeName))
  return full.startsWith(base) ? full : null
}
