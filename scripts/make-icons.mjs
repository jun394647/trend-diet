// 앱 아이콘 PNG를 외부 도구 없이 생성한다. 실행: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

const distToSegment = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

function render(size) {
  const bg = [15, 118, 110]
  const line = [255, 255, 255]
  const dot = [253, 230, 138]
  // 64 단위 좌표계. 마스커블 안전 영역 안에 들어오도록 가운데에 배치했다.
  const pts = [[16, 25], [26, 30], [35, 27.5], [48, 40]]
  const s = size / 64
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const ux = (x + 0.5) / s
      const uy = (y + 0.5) / s
      let d = Infinity
      for (let i = 0; i < pts.length - 1; i++) {
        d = Math.min(d, distToSegment(ux, uy, ...pts[i], ...pts[i + 1]))
      }
      const aa = 1 / s
      let c = mix(bg, line, Math.max(0, Math.min(1, (2.4 - d) / aa + 0.5)))
      const dd = Math.hypot(ux - 48, uy - 40)
      c = mix(c, dot, Math.max(0, Math.min(1, (4.6 - dd) / aa + 0.5)))
      const o = y * (size * 4 + 1) + 1 + x * 4
      raw[o] = c[0]
      raw[o + 1] = c[1]
      raw[o + 2] = c[2]
      raw[o + 3] = 255
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

for (const [name, size] of [['pwa-192.png', 192], ['pwa-512.png', 512], ['apple-touch-icon.png', 180]]) {
  writeFileSync(new URL(`../public/${name}`, import.meta.url), render(size))
  console.log('wrote', name)
}
