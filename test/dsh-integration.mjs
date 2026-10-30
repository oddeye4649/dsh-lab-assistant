import assert from 'node:assert/strict'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
// 不写死任何人的本机路径：puppeteer-core 由使用者自己提供。
const PUPPETEER = process.env.PUPPETEER_CORE_PATH || ''
if (!PUPPETEER) {
  throw new Error('未设置 PUPPETEER_CORE_PATH：请指向 puppeteer-core 的 lib/esm/puppeteer/puppeteer-core.js')
}
const PACKAGE_VERSION = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version
const url = process.argv[2]
if (!url) throw new Error('用法：node test/dsh-integration.mjs <DSH_URL>')

const SHOTS = resolve(process.cwd(), 'test-output', 'screenshots')
mkdirSync(SHOTS, { recursive: true })
const { default: puppeteer } = await import(pathToFileURL(PUPPETEER).href)
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
})
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
const pageErrors = []
const consoleErrors = []
const failedRequests = []
page.on('pageerror', (error) => pageErrors.push(error.message))
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
page.on('requestfailed', (request) => failedRequests.push(`${request.url()} :: ${request.failure()?.errorText}`))
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  // 0.6.0 起：桌宠只在桌面伴随进程里，网页不再注入
  await page.waitForFunction(() => !window.LabAssistant && !document.querySelector('#dsh-lab-root'), { timeout: 15000 })
  const api = await page.evaluate(async () => {
    const response = await fetch('/dsh-lab/api/status')
    return response.json()
  })
  assert.equal(api.plugin, 'dsh-lab-assistant')
  assert.equal(api.version, PACKAGE_VERSION)
  const repair = await page.evaluate(async () => {
    const response = await fetch('/dsh-lab/api/repair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ software: 'ensp', symptom: '启动设备失败，错误代码 40' }),
    })
    return response.json()
  })
  assert.equal(repair.ok, true)
  assert.equal(repair.symptom.matched, 'ensp-device-start-fail')
  assert.ok(repair.candidates.length >= 3)
  assert.equal(repair.policy.autoInstall, false)
  const report = await page.evaluate(async () => {
    const created = await fetch('/dsh-lab/api/experiments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '验收实验', software: 'eNSP' }),
    }).then((response) => response.json())
    const generated = await fetch('/dsh-lab/api/report/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ experimentId: created.experiment.id, studentName: '验收', studentId: '0001' }),
    }).then((response) => response.json())
    return { experimentId: created.experiment.id, ...generated }
  })
  assert.equal(report.ok, true)
  assert.ok(report.files.docx.endsWith('.docx'))
  assert.ok(report.placeholderCount > 0)
  await page.screenshot({ path: join(SHOTS, 'dsh-live.png') })
  assert.equal(pageErrors.length, 0, pageErrors.join(' | '))
  console.log(`dsh integration ok: screenshot=${join(SHOTS, 'dsh-live.png')}`)
} finally {
  await browser.close()
}
