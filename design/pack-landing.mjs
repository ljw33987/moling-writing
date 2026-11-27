// 把 landing/ 打包成可上传的 zip（纯 Node，无第三方依赖）
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(__dirname, 'landing')
const OUT = path.join(__dirname, 'moling-landing.zip')

function walk(dir, base = '') {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '_preview' || e.name === 'preview.mjs' || e.name.startsWith('_p')) continue
    const rel = base ? `${base}/${e.name}` : e.name
    const abs = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(abs, rel))
    else out.push({ rel, abs })
  }
  return out
}

const files = walk(SRC).filter(f => f.rel === 'index.html' || f.rel.startsWith('assets/') || f.rel === 'README.md')

// ---- 最小 ZIP 写入器（store + deflate）----
const chunks = []
const central = []
let offset = 0

function crc32(buf) {
  let c, table = crc32.t
  if (!table) {
    table = crc32.t = []
    for (let n = 0; n < 256; n++) {
      c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosTime(d = new Date()) {
  const time = ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() / 2)) & 0xffff
  const date = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff
  return { time, date }
}

for (const f of files) {
  const name = Buffer.from(f.rel, 'utf8')
  const raw = fs.readFileSync(f.abs)
  const deflated = zlib.deflateRawSync(raw, { level: 9 })
  const useDeflate = deflated.length < raw.length
  const data = useDeflate ? deflated : raw
  const method = useDeflate ? 8 : 0
  const { time, date } = dosTime()
  const crc = crc32(raw)

  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(20, 4)            // version needed
  local.writeUInt16LE(0x0800, 6)        // flag: UTF-8 name
  local.writeUInt16LE(method, 8)
  local.writeUInt16LE(time, 10)
  local.writeUInt16LE(date, 12)
  local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(data.length, 18)
  local.writeUInt32LE(raw.length, 22)
  local.writeUInt16LE(name.length, 26)
  local.writeUInt16LE(0, 28)
  chunks.push(local, name, data)

  const cen = Buffer.alloc(46)
  cen.writeUInt32LE(0x02014b50, 0)
  cen.writeUInt16LE(20, 4)             // version made by
  cen.writeUInt16LE(20, 6)             // version needed
  cen.writeUInt16LE(0x0800, 8)
  cen.writeUInt16LE(method, 10)
  cen.writeUInt16LE(time, 12)
  cen.writeUInt16LE(date, 14)
  cen.writeUInt32LE(crc, 16)
  cen.writeUInt32LE(data.length, 20)
  cen.writeUInt32LE(raw.length, 24)
  cen.writeUInt16LE(name.length, 28)
  cen.writeUInt16LE(0, 30)             // extra
  cen.writeUInt16LE(0, 32)             // comment
  cen.writeUInt16LE(0, 34)             // disk
  cen.writeUInt16LE(0, 36)             // internal attrs
  cen.writeUInt32LE(0o644 << 16, 38)   // external attrs
  cen.writeUInt32LE(offset, 42)
  central.push(Buffer.concat([cen, name]))

  offset += local.length + name.length + data.length
}

const centralBuf = Buffer.concat(central)
const end = Buffer.alloc(22)
end.writeUInt32LE(0x06054b50, 0)
end.writeUInt16LE(0, 4)
end.writeUInt16LE(0, 6)
end.writeUInt16LE(files.length, 8)
end.writeUInt16LE(files.length, 10)
end.writeUInt32LE(centralBuf.length, 12)
end.writeUInt32LE(offset, 16)
end.writeUInt16LE(0, 20)

fs.writeFileSync(OUT, Buffer.concat([...chunks, centralBuf, end]))
console.log('✓', path.basename(OUT), (fs.statSync(OUT).size / 1024).toFixed(1) + ' KB', files.length + ' 个文件')
files.forEach(f => console.log('   ' + f.rel))
