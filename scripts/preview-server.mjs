import http from 'node:http'
import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import * as pluginModule from '../index.js'

const HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>实验助手预览</title>
<style>
  :root { --ink:#18243d; --muted:#66738c; --blue:#315fba; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; font-family:"Microsoft YaHei UI","Microsoft YaHei",sans-serif; color:var(--ink); background:linear-gradient(145deg,#edf4ff 0%,#faf7f0 58%,#e8f1ff 100%); }
  .shell { min-height:100vh; display:grid; grid-template-rows:64px 1fr; }
  header { display:flex; align-items:center; gap:13px; padding:0 26px; border-bottom:1px solid #dbe5f2; background:rgba(255,255,255,.82); backdrop-filter:blur(12px); }
  .brand { width:31px; height:31px; border-radius:10px; background:linear-gradient(145deg,#3b73cf,#1e4385); display:grid; place-items:center; color:#fff; font-size:17px; }
  .title { font-weight:800; font-size:15px; }
  .sub { color:var(--muted); font-size:11px; }
  main { display:grid; place-items:center; padding:30px; }
  .hero { width:min(720px,92vw); text-align:center; }
  .hero h1 { font-size:clamp(28px,4vw,50px); margin:0 0 12px; letter-spacing:-.04em; }
  .hero h1 span { color:var(--blue); }
  .hero p { color:var(--muted); font-size:14px; line-height:1.8; margin:0 auto 32px; max-width:540px; }
  .composer { background:#fff; border:1px solid #d7e2f0; border-radius:20px; padding:18px; text-align:left; box-shadow:0 18px 45px rgba(31,58,105,.1); }
  .composer .prompt { min-height:78px; color:#9aa6b9; font-size:14px; padding:8px; }
  .composer .bar { display:flex; justify-content:space-between; align-items:center; padding-top:12px; border-top:1px solid #eef2f7; }
  .pill { border-radius:999px; background:#edf4ff; color:#315fba; padding:6px 11px; font-size:11px; font-weight:700; }
  .send { width:36px; height:36px; border-radius:12px; background:#315fba; color:#fff; display:grid; place-items:center; }
</style>
</head>
<body>
<div class="shell">
  <header><div class="brand">✦</div><div><div class="title">DeepSeek Harness</div><div class="sub">实验助手桌宠预览</div></div></header>
  <main><section class="hero">
    <h1>让实验步骤<br><span>清楚一点。</span></h1>
    <p>这是用于检查 dsh-lab-assistant 桌宠浮层、实验档案与指引效果的本地预览页。它不是最终 DSH 界面。</p>
    <div class="composer"><div class="prompt">描述你今天的实验任务……</div><div class="bar"><span class="pill">实验助手已加载</span><span class="send">↑</span></div></div>
  </section></main>
</div>
</body>
</html>`

function fakeCtx(home) {
  const routes = []
  const ctx = {
    get(key) {
      if (key === 'dshHomePath') return (...parts) => join(home, ...parts)
      return undefined
    },
    tools: { register: (tool) => tool },
    webServer: {
      register: (route) => { routes.push(route); return () => {} },
      tapIndex: () => () => {},
    },
    effect(fn) { return fn() },
    inject(_services, cb) { cb(ctx) },
    on() {},
  }
  return { ctx, routes }
}

export async function startPreview({ home = resolve(process.cwd(), 'test-output', 'preview-home'), port = 0 } = {}) {
  mkdirSync(home, { recursive: true })
  const { ctx, routes } = fakeCtx(home)
  const plugin = pluginModule.default ?? pluginModule
  plugin.apply(ctx, { displayName: '主人', petSize: 160 })
  const route = routes[0]
  const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url?.startsWith('/?')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(HTML)
      return
    }
    if (req.url?.startsWith('/dsh-lab/')) return route.handler(req, res)
    if (req.url === '/favicon.ico') {
      res.writeHead(204)
      res.end()
      return
    }
    res.writeHead(404)
    res.end('not found')
  })
  await new Promise((resolveReady) => server.listen(port, '127.0.0.1', resolveReady))
  return {
    server,
    port: server.address().port,
    url: `http://127.0.0.1:${server.address().port}/`,
    close: () => new Promise((resolveClosed) => server.close(resolveClosed)),
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const instance = await startPreview({ port: Number(process.env.PORT) || 4317 })
  console.log(`实验助手预览：${instance.url}`)
}
