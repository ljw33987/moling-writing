// 落地页分段预览截图（CDP 精确视口，不再受 Chrome 窗口宽度下限影响）
// 用法：node preview.mjs [偏移量...]
//      DARK=1 node preview.mjs 0 2100   → 深色主题
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { withPage } from './cdp.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const URL_ = 'file:///' + path.join(__dirname, 'index.html').replace(/\\/g, '/')
const OUT = path.join(__dirname, '_preview')
const DARK = process.env.DARK === '1'
const W = +(process.env.W || 1600)
const H = +(process.env.H || 1000)
const DSF = +(process.env.DSF || 2)

const offsets = process.argv.slice(2).map(Number).filter(n => !Number.isNaN(n))
const list = offsets.length ? offsets : [0]

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true })

await withPage(URL_, { width: W, height: H, dsf: DSF, mobile: false, theme: DARK ? 'dark' : 'light' }, async (api) => {
  for (const y of list) {
    await api.scrollTo(y)
    await new Promise(r => setTimeout(r, 700))
    const suffix = DARK ? 'd' : ''
    const file = path.join(OUT, `p${y}${suffix}.png`)
    await api.shot(file)
    console.log('✓', path.basename(file))
  }
})
