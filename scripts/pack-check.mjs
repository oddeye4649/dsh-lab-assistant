import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

assert.equal(pkg.name, 'dsh-lab-assistant')
assert.match(pkg.version, /^\d+\.\d+\.\d+$/)
assert.equal(pkg.dsh?.bundle?.patch, './cordis.patch.yml')
assert.ok(pkg.files.includes('assets'))
assert.ok(pkg.files.includes('lib'))
assert.ok(pkg.engines?.dsh)

for (const file of [
  'index.js',
  'cordis.patch.yml',
  'README.md',
  'LICENSE',
  'assets/icon.png',
  'assets/pet/idle.png',
  'assets/pet/swim_1.png',
  'assets/pet/swim_8.png',
  'assets/pet/dash_1.png',
  'assets/pet/dash_3.png',
  'assets/pet/point.png',
  'assets/pet/happy.png',
  'assets/pet/confused.png',
  'overlay/LabPet.cs',
  'overlay/app.manifest',
]) {
  assert.ok(existsSync(join(root, file)), `缺少发布文件：${file}`)
}

const icon = readFileSync(join(root, 'assets/icon.png'))
assert.equal(icon.subarray(1, 4).toString(), 'PNG', 'assets/icon.png 必须是 PNG')
const width = icon.readUInt32BE(16)
const height = icon.readUInt32BE(20)
assert.equal(width, height, '插件图标必须是正方形')
assert.ok(width >= 128, '插件图标边长至少 128px')

const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
assert.match(patch, /name: dsh-lab-assistant/)
assert.match(patch, /id: lab-assistant/)

console.log('pack check ok:', `${pkg.name}@${pkg.version}`, `icon=${width}x${height}`)
