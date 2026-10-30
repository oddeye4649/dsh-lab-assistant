// 桌面伴随进程的编译/启动在沙箱里会被拦截，网页表面检查不需要它。
process.env.DSH_LAB_OVERLAY = '0'

import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// 桌面伴随进程的编译/启动在沙箱里会被拦截，网页表面检查不需要它。
// 必须在动态加载插件之前设置（ESM import 会提升）。
process.env.DSH_LAB_OVERLAY = '0'
const { startPreview } = await import('../scripts/preview-server.mjs')

// 0.6.0 起：桌宠与实验助手面板都在桌面伴随进程里，网页不再注入任何 UI。
// 这里验证网页表面是干净的、API 仍然可用。
const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
// 不写死任何人的本机路径：puppeteer-core 由使用者自己提供（npm i -D puppeteer-core 后指向它的入口）。
const PUPPETEER = process.env.PUPPETEER_CORE_PATH || ''
if (!PUPPETEER) {
  throw new Error('未设置 PUPPETEER_CORE_PATH：请指向 puppeteer-core 的 lib/esm/puppeteer/puppeteer-core.js')
}
const HOME = resolve(process.cwd(), 'test-output', 'ui-home')
const SHOTS = resolve(process.cwd(), 'test-output', 'screenshots')

rmSync(HOME, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })

const { default: puppeteer } = await import(pathToFileURL(PUPPETEER).href)
const preview = await startPreview({ home: HOME })
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--user-data-dir=${join(HOME, 'chrome-profile')}`],
})

const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))

try {
  await page.goto(preview.url, { waitUntil: 'networkidle0' })
  await page.waitForFunction(() => !window.LabAssistant && !document.querySelector('#dsh-lab-root'), { timeout: 10000 })
  const status = await page.evaluate(async () => (await fetch('/dsh-lab/api/status')).json())
  assert.equal(status.plugin, 'dsh-lab-assistant')

  const petJs = await page.evaluate(async () => (await fetch('/dsh-lab/pet.js')).status)
  assert.equal(petJs, 404, '网页桌宠已下线')

  const created = await page.evaluate(async () => (await fetch('/dsh-lab/api/experiments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '接口冒烟实验', course: '验收', software: 'eNSP' }),
  })).json())
  assert.equal(created.ok, true)

  const generated = await page.evaluate(async (id) => (await fetch('/dsh-lab/api/report/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ experimentId: id, studentName: '验收', studentId: '0001' }),
  })).json(), created.experiment.id)
  assert.equal(generated.ok, true)
  assert.ok(generated.files.docx.endsWith('.docx'))

  await page.screenshot({ path: join(SHOTS, 'lab-assistant-guide.png'), fullPage: false })
  assert.equal(pageErrors.length, 0, `页面异常：${pageErrors.join(' | ')}`)
  console.log(`ui check ok: page clean, api ok, screenshot=${join(SHOTS, 'lab-assistant-guide.png')}`)
} finally {
  await browser.close()
  await preview.close()
}
