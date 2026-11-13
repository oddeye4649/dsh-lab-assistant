// 发现文件（desktop.json）的读写，MCP 与桌面启动器共用一份，避免两边各写一套实现后再漂移。
//
// 为什么需要它：启动器启动时会覆盖这个文件。旧实现用 writeFileSync 直接写（打开 → 截断 → 写入），
// MCP 如果恰好在这几微秒里读，会拿到空字符串 → JSON.parse 失败 → 被当成「启动器没开」，
// 于是退回本地写；而启动器其实已经活着，于是出现两个写入点，后写的覆盖先写的。
// 现在写侧改成「临时文件 + rename」原子替换，读侧对「文件存在但内容读不出」做几次极短重试，
// 两边都不再赌那个窗口。
import {
  chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname } from 'node:path'

const READ_RETRIES = 2
const READ_DELAY_MS = 25
const RENAME_RETRIES = 3
const RENAME_DELAY_MS = 10
let warnedRenameFallback = false
let warnedReadFailure = false

function warnReadFailure(error) {
  if (warnedReadFailure) return
  warnedReadFailure = true
  try { process.stderr.write(`[discovery] 读取失败：${error && error.message}\n`) } catch { }
}

// 同步短睡：这里只需要几十毫秒，且调用点（MCP 的 stdin 处理、启动器的启动流程）本身是串行的。
// 用 Atomics.wait 而不是忙等，避免空转烧 CPU。
function sleepSync(ms) {
  if (!(ms > 0)) return
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch {
    // 极少数环境禁用 SharedArrayBuffer：跳过等待，最多少重试一次，不影响正确性。
  }
}

export function isPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

/**
 * 读发现文件。返回 null 表示「没有 / 读不出 / 内容坏了」，调用方按「启动器没开」处理。
 * - 文件不存在（ENOENT）是常态，立即返回，不引入任何延迟；
 * - 只有「文件在、但空或解析失败」才重试，那才是「正在被写」的特征；
 * - 权限/占用类错误直接返回，等几十毫秒不会自愈。
 */
export function readDiscoveryFile(file, { retries = READ_RETRIES, delayMs = READ_DELAY_MS } = {}) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let raw
    try {
      raw = readFileSync(file, 'utf8')
    } catch (error) {
      // 文件不存在是常态（启动器没开），立即返回，不引入延迟。
      if (error && error.code === 'ENOENT') return null
      // 权限/占用类错误不会因为多等几十毫秒就自愈，没必要重试。
      warnReadFailure(error)
      return null
    }
    if (raw.trim()) {
      try {
        return JSON.parse(raw)
      } catch (error) {
        // 解析失败才是「正在写」的典型特征：等一下再读。
        if (attempt >= retries) { warnReadFailure(error); return null }
        sleepSync(delayMs)
        continue
      }
    }
    // 空文件同理。
    if (attempt >= retries) {
      warnReadFailure(new Error('内容为空，可能正在写入'))
      return null
    }
    sleepSync(delayMs)
  }
  return null
}

/**
 * 原子写发现文件：先写同目录临时文件，再 rename 覆盖。
 * Windows 上目标正被别的进程打开时 rename 可能 EBUSY/EPERM，短暂重试几次。
 */
export function writeDiscoveryFile(file, data) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  const payload = `${JSON.stringify(data, null, 2)}\n`
  try {
    writeFileSync(tmp, payload, { encoding: 'utf8', mode: 0o600 })
    try { chmodSync(tmp, 0o600) } catch { /* Windows 上尽力而为 */ }
    let lastError = null
    for (let attempt = 0; attempt <= RENAME_RETRIES; attempt += 1) {
      try {
        renameSync(tmp, file)
        return
      } catch (error) {
        lastError = error
        if (attempt < RENAME_RETRIES) sleepSync(RENAME_DELAY_MS)
      }
    }
    // 走到这里说明 rename 一直被拒：受限沙箱、杀软、网络盘、OneDrive 占用都可能。
    // 退回直写——原子性没了，但启动器不能因为写不了发现文件就起不来。
    // 读侧还有短重试兜底，能覆盖大部分直写窗口。
    if (!warnedRenameFallback) {
      warnedRenameFallback = true
      try { process.stderr.write(`[discovery] rename 不可用（${lastError && lastError.code}），退回直写\n`) } catch { }
    }
    writeFileSync(file, payload, { encoding: 'utf8', mode: 0o600 })
    try { chmodSync(file, 0o600) } catch { /* 同上 */ }
    try { unlinkSync(tmp) } catch { /* 已经被 rename 走 */ }
  } catch (error) {
    try { unlinkSync(tmp) } catch { /* 临时文件可能不存在 */ }
    throw error
  }
}
