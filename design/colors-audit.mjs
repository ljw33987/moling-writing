// 统计设计稿里写死的颜色
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const dir = path.join(__dirname, 'screens')
const files = fs.readdirSync(dir).filter(f => f.endsWith('.body.html'))

const count = new Map()
for (const f of files) {
  const t = fs.readFileSync(path.join(dir, f), 'utf8')
  for (const m of t.matchAll(/#[0-9A-Fa-f]{6}\b/g)) {
    const c = m[0].toLowerCase()
    count.set(c, (count.get(c) || 0) + 1)
  }
}
console.log('=== 颜色频次（写死在 HTML 里的）===')
;[...count.entries()].sort((a, b) => b[1] - a[1]).forEach(([c, n]) => console.log('  ' + c, n))

// 看关键颜色的上下文
const sample = (file, re) => {
  const t = fs.readFileSync(path.join(dir, file), 'utf8')
  const hits = [...t.matchAll(re)].slice(0, 4)
  hits.forEach(h => console.log('    ' + file + ' :: ' + h[0].replace(/\s+/g, ' ').slice(0, 110)))
}
console.log('\n=== 上下文抽样 ===')
sample('02-workspace.body.html', /[^"]*linear-gradient[^;]*;/g)
sample('04-settings.body.html', /style="[^"]*linear-gradient[^"]*"/g)
sample('03-editor.body.html', /linear-gradient[^;]*;/g)
sample('01-auth.body.html', /linear-gradient[^;]*;/g)
sample('m-02-workspace.body.html', /style="[^"]*linear-gradient[^"]*"/g)
