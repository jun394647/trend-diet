// 앱 아이콘을 외부 도구 없이 생성한다. 실행: node scripts/make-icons.mjs
//
// 표식: 짙은 남색 바탕 위로 내려가는 체중 추세선, 그 끝에 "지금"을 가리키는 꿀색 점.
// 같은 도형으로 PNG 여러 장(일반, 마스커블, 단색, iOS용, 파비콘)과 favicon.svg를 함께 만든다.
// 스플래시(index.html, src/components/Splash.tsx)의 SVG도 여기서 출력하는 경로를 그대로 쓴다.
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

// ── PNG 쓰기 ────────────────────────────────────────────
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
/** pixels: RGBA 바이트. alpha가 false면 투명 채널이 아예 없는 RGB PNG로 쓴다. */
function png(size, pixels, alpha) {
  const bpp = alpha ? 4 : 3
  const raw = Buffer.alloc(size * (size * bpp + 1))
  for (let y = 0; y < size; y++) {
    const row = y * (size * bpp + 1)
    raw[row] = 0
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4
      const o = row + 1 + x * bpp
      raw[o] = pixels[i]
      raw[o + 1] = pixels[i + 1]
      raw[o + 2] = pixels[i + 2]
      if (alpha) raw[o + 3] = pixels[i + 3]
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = alpha ? 6 : 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ── 표식의 도형 ─────────────────────────────────────────
// 표식 좌표계: 가로 절반 폭이 1. 가운데가 (0, 0)이 되도록 눈으로 맞춘 값이다.
const KNOTS = [
  [-1.02, -0.5],
  [-0.38, -0.2],
  [0.16, -0.27],
  [0.9, 0.44],
]
const LINE_HALF = 0.145 // 선 굵기의 절반
const DOT_R = 0.27 // 꿀색 점
const GAP = 0.115 // 점과 선 사이를 띄우는 바탕색 고리. 작은 크기에서 점이 선에 묻히지 않게 한다.

// 매듭을 지나는 부드러운 곡선(Catmull-Rom)을 3차 베지어 조각으로 바꾼다.
const BEZIERS = KNOTS.slice(0, -1).map((p1, i) => {
  const p0 = KNOTS[Math.max(0, i - 1)]
  const p2 = KNOTS[i + 1]
  const p3 = KNOTS[Math.min(KNOTS.length - 1, i + 2)]
  return [
    p1,
    [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6],
    [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6],
    p2,
  ]
})
const bezierAt = ([a, b, c, d], t) => {
  const u = 1 - t
  return [0, 1].map((k) => u * u * u * a[k] + 3 * u * u * t * b[k] + 3 * u * t * t * c[k] + t * t * t * d[k])
}
const SAMPLES = BEZIERS.flatMap((bz, i) =>
  Array.from({ length: i === BEZIERS.length - 1 ? 25 : 24 }, (_, k) => bezierAt(bz, k / 24)),
)
const END = KNOTS[KNOTS.length - 1]

const distToSegment = (px, py, [ax, ay], [bx, by]) => {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
const distToLine = (px, py) => {
  let d = Infinity
  for (let i = 0; i < SAMPLES.length - 1; i++) d = Math.min(d, distToSegment(px, py, SAMPLES[i], SAMPLES[i + 1]))
  return d
}
/** 둥근 사각형까지의 부호 있는 거리. 안쪽이 음수다. */
const roundedRect = (px, py, half, r) => {
  const qx = Math.abs(px) - (half - r)
  const qy = Math.abs(py) - (half - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

const GROUND_TOP = [38, 41, 104]
const GROUND_BOTTOM = [23, 25, 64]
const LINE = [255, 255, 255]
const DOT = [242, 184, 78]
const clamp01 = (v) => Math.max(0, Math.min(1, v))
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t)

/**
 * @param size   한 변의 픽셀 수
 * @param mark   표식의 가로 절반 폭(캔버스 한 변에 대한 비율)
 * @param tile   바탕. null이면 투명, { half, radius }는 둥근 사각형(캔버스 한 변에 대한 비율)
 * @param mono   단색 아이콘. 색은 버리고 모양만 불투명도로 남긴다.
 */
function render({ size, mark, tile, mono = false }) {
  const px = new Uint8ClampedArray(size * size * 4)
  const aa = 1 / size // 한 픽셀의 폭(캔버스 단위)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // 캔버스 단위: 가운데가 (0, 0), 한 변이 1
      const cx = (x + 0.5) / size - 0.5
      const cy = (y + 0.5) / size - 0.5
      const mx = cx / mark
      const my = cy / mark
      const cover = (dist) => clamp01(0.5 - (dist * mark) / aa)
      const line = cover(distToLine(mx, my) - LINE_HALF)
      const dd = Math.hypot(mx - END[0], my - END[1])
      const gap = cover(dd - (DOT_R + GAP))
      const dot = cover(dd - DOT_R)

      let rgb
      let alpha
      if (mono) {
        rgb = LINE
        alpha = Math.max(line * (1 - gap), dot)
      } else {
        const ground = mix(GROUND_TOP, GROUND_BOTTOM, clamp01(cy + 0.5))
        rgb = mix(ground, LINE, line)
        rgb = mix(rgb, ground, gap)
        rgb = mix(rgb, DOT, dot)
        alpha = tile ? clamp01(0.5 - roundedRect(cx, cy, tile.half, tile.radius) / aa) : 0
      }
      const o = (y * size + x) * 4
      px[o] = rgb[0]
      px[o + 1] = rgb[1]
      px[o + 2] = rgb[2]
      px[o + 3] = alpha * 255
    }
  }
  return px
}

// ── 산출물 ──────────────────────────────────────────────
const FULL = { half: 0.5, radius: 0 }
/** 모서리가 둥근 타일. 가장자리에 숨 쉴 틈을 조금 둔다. */
const TILE = { half: 0.46, radius: 0.205 }

const outputs = [
  // 일반 아이콘: 둥근 타일 + 투명한 여백
  { name: 'pwa-192.png', size: 192, mark: 0.28, tile: TILE, alpha: true },
  { name: 'pwa-512.png', size: 512, mark: 0.28, tile: TILE, alpha: true },
  // 마스커블: 가장자리까지 채우고, 표식은 가운데 80% 안전 영역(반지름 0.4) 안에 둔다.
  { name: 'maskable-192.png', size: 192, mark: 0.262, tile: FULL, alpha: false },
  { name: 'maskable-512.png', size: 512, mark: 0.262, tile: FULL, alpha: false },
  // 단색: 테마 아이콘용. 모양만 남긴다.
  { name: 'monochrome-512.png', size: 512, mark: 0.262, tile: null, mono: true, alpha: true },
  // iOS: 투명 없이 꽉 채운다. 모서리는 iOS가 깎는다.
  { name: 'apple-touch-icon.png', size: 180, mark: 0.3, tile: FULL, alpha: false },
  // SVG 파비콘을 못 쓰는 브라우저용
  { name: 'favicon-32.png', size: 32, mark: 0.3, tile: { half: 0.5, radius: 0.22 }, alpha: true },
]

for (const { name, alpha, ...opts } of outputs) {
  writeFileSync(new URL(`../public/${name}`, import.meta.url), png(opts.size, render(opts), alpha))
  console.log('wrote', name)
}

// ── 바로가기 아이콘 ─────────────────────────────────────
// 아이콘을 길게 눌렀을 때 나오는 "식사 추가", "체중 기록" 옆에 붙는다. 남색 원 위에 흰 선 그림.
const SHORTCUTS = {
  // 더하기
  'shortcut-meal.png': (x, y) => Math.min(distToSegment(x, y, [-0.15, 0], [0.15, 0]), distToSegment(x, y, [0, -0.15], [0, 0.15])) - 0.034,
  // 체중계: 둥근 네모 테두리 + 위쪽의 둥근 눈금창 + 바늘
  'shortcut-weight.png': (x, y) =>
    Math.min(
      Math.abs(roundedRect(x, y, 0.2, 0.08)) - 0.027,
      Math.abs(Math.hypot(x, y + 0.045) - 0.078) - 0.022,
      distToSegment(x, y, [0, -0.045], [0.03, -0.085]) - 0.02,
    ),
}
for (const [name, glyph] of Object.entries(SHORTCUTS)) {
  const size = 192
  const px = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = (x + 0.5) / size - 0.5
      const cy = (y + 0.5) / size - 0.5
      const ground = mix(GROUND_TOP, GROUND_BOTTOM, clamp01(cy + 0.5))
      const rgb = mix(ground, LINE, clamp01(0.5 - glyph(cx, cy) * size))
      const o = (y * size + x) * 4
      px[o] = rgb[0]
      px[o + 1] = rgb[1]
      px[o + 2] = rgb[2]
      px[o + 3] = clamp01(0.5 - (Math.hypot(cx, cy) - 0.5) * size) * 255
    }
  }
  writeFileSync(new URL(`../public/${name}`, import.meta.url), png(size, px, true))
  console.log('wrote', name)
}

// 마스커블 안전 영역 확인: 표식의 가장 먼 점이 반지름 0.4 안에 있어야 한다.
const reach = Math.max(
  ...SAMPLES.map(([x, y]) => Math.hypot(x, y) + LINE_HALF),
  Math.hypot(END[0], END[1]) + DOT_R,
)
const maskReach = reach * 0.262
if (maskReach > 0.4) throw new Error(`마스커블 안전 영역을 벗어났어요: ${maskReach.toFixed(3)}`)
console.log('maskable reach', maskReach.toFixed(3), '(<= 0.400)')

// ── SVG ─────────────────────────────────────────────────
/** 표식을 viewBox 64 기준 SVG 조각으로 만든다. scale은 표식의 가로 절반 폭(px). */
function markSvg(scale) {
  const f = (v) => +(32 + v * scale).toFixed(2)
  const d =
    `M${f(BEZIERS[0][0][0])} ${f(BEZIERS[0][0][1])}` +
    BEZIERS.map(([, b, c, e]) => `C${f(b[0])} ${f(b[1])} ${f(c[0])} ${f(c[1])} ${f(e[0])} ${f(e[1])}`).join('')
  const r = (v) => +(v * scale).toFixed(2)
  return { d, width: r(LINE_HALF * 2), cx: f(END[0]), cy: f(END[1]), gap: r(DOT_R + GAP), dot: r(DOT_R) }
}

const fav = markSvg(64 * 0.3)
// 탭이 어두우면 남색 타일이 묻히므로, 어두운 테마에서는 바탕을 한 단계 밝힌다.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><style>.g{fill:#1c1e4b}@media (prefers-color-scheme:dark){.g{fill:#3b3fa3}}</style><rect class="g" width="64" height="64" rx="14"/><path d="${fav.d}" fill="none" stroke="#fff" stroke-width="${fav.width}" stroke-linecap="round" stroke-linejoin="round"/><circle class="g" cx="${fav.cx}" cy="${fav.cy}" r="${fav.gap}"/><circle cx="${fav.cx}" cy="${fav.cy}" r="${fav.dot}" fill="#f2b84e"/></svg>\n`
writeFileSync(new URL('../public/favicon.svg', import.meta.url), favicon)
console.log('wrote favicon.svg')

// 스플래시에 넣을 값. 바꾸면 index.html과 src/components/Splash.tsx도 함께 고친다.
console.log('splash mark (viewBox 64):', JSON.stringify(markSvg(64 * 0.28)))
