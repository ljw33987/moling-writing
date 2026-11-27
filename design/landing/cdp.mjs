// 最小 CDP 客户端：精确设备视口模拟 + 交互 + 截图
// 解决 Chrome 在 Windows 上把 --window-size 钳制到 ~500px 下限、无法测 390px 的问题
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const CHROME = 'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

export async function withPage(url, opts, fn) {
  const { width = 390, height = 844, dsf = 3, mobile = true, theme = null } = opts || {}
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cdp-'))
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
    '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    `--remote-debugging-port=0`, `--user-data-dir=${dir}`,
    `--window-size=${Math.max(width, 500)},${height}`,
    'about:blank',
  ], { stdio: 'ignore' })

  let port = null
  const portFile = path.join(dir, 'DevToolsActivePort')
  for (let i = 0; i < 100 && !port; i++) {
    if (fs.existsSync(portFile)) {
      const t = fs.readFileSync(portFile, 'utf8').split('\n')
      if (t[0] && t[0].trim()) { port = t[0].trim(); break }
    }
    await sleep(100)
  }
  if (!port) { proc.kill(); throw new Error('Chrome DevTools 端口未就绪') }

  // 打开目标页面
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  let target = list.find(t => t.type === 'page')
  if (!target) {
    const created = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
    target = created
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = (e) => rej(new Error('WS 连接失败: ' + e.message))
  })

  let seq = 0
  const pending = new Map()
  const listeners = []
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
    } else if (msg.method) {
      listeners.forEach(fn => fn(msg))
    }
  }
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++seq
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(method + ' 超时')) } }, 45000)
  })
  const once = (method, timeout = 20000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => { off(); reject(new Error('等待 ' + method + ' 超时')) }, timeout)
    const fn = (msg) => { if (msg.method === method) { off(); clearTimeout(t); resolve(msg.params) } }
    const off = () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1) }
    listeners.push(fn)
  })

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: dsf, mobile,
    screenWidth: width, screenHeight: height,
  })
  if (mobile) {
    await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
  }
  await send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: theme === 'dark' ? 'dark' : 'light' }],
  })

  const loaded = once('Page.loadEventFired')
  await send('Page.navigate', { url })
  await loaded
  await sleep(450)

  const api = {
    async evaluate(expr) {
      const r = await send('Runtime.evaluate', {
        expression: `(function(){${expr}})()`,
        returnByValue: true, awaitPromise: true,
      })
      if (r.exceptionDetails) throw new Error('JS 异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
      return r.result.value
    },
    async shot(file, opts = {}) {
      const r = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: !!opts.full,
        ...(opts.full ? { clip: undefined } : {}),
      })
      fs.writeFileSync(file, Buffer.from(r.data, 'base64'))
      return file
    },
    async click(sel) {
      return api.evaluate(`
        var el=document.querySelector(${JSON.stringify(sel)});
        if(!el) return 'NO-EL';
        el.click(); return 'OK';
      `)
    },
    async scrollTo(y) { await api.evaluate(`window.scrollTo(0, ${y}); return 1`) },
    async resize(w, h, d = dsf, m = mobile) {
      await send('Emulation.setDeviceMetricsOverride', {
        width: w, height: h, deviceScaleFactor: d, mobile: m,
        screenWidth: w, screenHeight: h,
      })
      await sleep(320)
    },
    send,
  }

  try {
    return await fn(api)
  } finally {
    try { ws.close() } catch {}
    proc.kill()
    await sleep(200)
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch {}
  }
}

export { sleep }
