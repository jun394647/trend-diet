// 식약처 「전국통합식품영양성분정보 표준데이터」(음식, 원재료성식품)를 받아 앱에 넣을 작은 JSON으로 줄인다.
//   node scripts/build-food-db.mjs            공공데이터포털에서 새로 받아서 만든다
//   node scripts/build-food-db.mjs a.json b.json   이미 받아 둔 원본({rows:[...]}) 파일들로 만든다
// 결과: public/food-db.json
import { readFileSync, writeFileSync } from 'node:fs'

// 음식(조리·외식 메뉴)과 원재료성 식품. 가공식품은 건수가 너무 많아 넣지 않는다.
const DATASETS = ['15100070', '15100065']
const headers = (pk) => ({
  'User-Agent': 'Mozilla/5.0',
  'X-Requested-With': 'XMLHttpRequest',
  Accept: 'application/json',
  Referer: `https://www.data.go.kr/data/${pk}/standard.do`,
})

async function download(pk) {
  const get = async (url) => {
    const res = await fetch(url, { headers: headers(pk) })
    if (!res.ok) throw new Error(`${res.status} ${url}`)
    return res.json()
  }
  const head = await get(`https://www.data.go.kr/download/columList.json?pk=${pk}&ext=JSON`)
  const perPage = 10000
  const rows = []
  for (let page = 1; page <= Math.ceil(head.totalCount / perPage); page++) {
    const q = new URLSearchParams({
      publicDataPk: pk,
      totalCount: String(head.totalCount),
      svcTableNm: head.tableVO.svcTableNm,
      perPage: String(perPage),
      page: String(page),
    })
    for (const c of head.tableVO.colNmList) q.append('colNmList', c)
    const part = await get(`https://www.data.go.kr/download/standard.json?${q}`)
    rows.push(...part)
    console.log(`${pk} page ${page}: ${part.length}`)
  }
  if (rows.length !== head.totalCount) {
    throw new Error(`${pk}: 받은 행 수(${rows.length})가 전체(${head.totalCount})와 다릅니다`)
  }
  return rows
}

const num = (v) => {
  if (v === '' || v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const round1 = (n) => (n === null ? null : Math.round(n * 10) / 10)

const rawPaths = process.argv.slice(2)
const rows = []
if (rawPaths.length > 0) {
  for (const p of rawPaths) rows.push(...JSON.parse(readFileSync(p, 'utf8')).rows)
} else {
  for (const pk of DATASETS) rows.push(...(await download(pk)))
}

/** 업체명이 없는 항목에 붙일 짧은 구분. */
function originTag(r) {
  if (r.TYPE_NM === '원재료성 식품') return '원재료'
  const o = String(r.FOOD_ORIGIN_NM ?? '')
  if (o.includes('가정식')) return '가정식'
  if (o.includes('급식')) return '급식'
  if (o.includes('외식')) return '외식'
  return ''
}

let noSize = 0
let skipped = 0
let updated = ''
let duplicates = 0
const seen = new Set()
const items = []
for (const r of rows) {
  const kcal = num(r.ENERC)
  const name = String(r.FOOD_NM ?? '').replaceAll('_', ' ').replace(/\s+/g, ' ').trim()
  if (kcal === null || kcal < 0 || !name) {
    skipped++
    continue
  }
  const unit = r.NUT_CON_SRTR_QUA === '100ml' ? 'ml' : 'g'
  // 1회 제공량은 '591g', '932.10ml' 같은 형태다. 다른 형태면 비워 둔다.
  const m = /^([\d.]+)\s*(g|ml)$/i.exec(String(r.FOOD_SIZE ?? '').trim())
  const size = m ? num(m[1]) : null
  if (size === null || size <= 0) noSize++
  const brand = r.REST_NM && r.REST_NM !== '해당없음' ? String(r.REST_NM).trim() : originTag(r)
  if (r.CRTR_YMD > updated) updated = r.CRTR_YMD
  // [이름, 업체 또는 구분, 100g(ml)당 kcal, 1회 제공량, 단위, 탄수화물, 단백질, 지방] — 영양소는 100g(ml)당 g
  const item = [
    name,
    brand,
    Math.round(kcal),
    size !== null && size > 0 ? round1(size) : null,
    unit,
    round1(num(r.CHOCDF)),
    round1(num(r.PROT)),
    round1(num(r.FATCE)),
  ]
  const key = JSON.stringify(item)
  if (seen.has(key)) {
    duplicates++
    continue
  }
  seen.add(key)
  items.push(item)
}
items.sort((a, b) => a[0].localeCompare(b[0], 'ko') || a[1].localeCompare(b[1], 'ko'))

const out = {
  source: '식품의약품안전처 전국통합식품영양성분정보 표준데이터(음식, 원재료성식품), 공공데이터포털',
  updated,
  items,
}
const text = JSON.stringify(out)
writeFileSync(new URL('../public/food-db.json', import.meta.url), text)
console.log(`items ${items.length}, duplicates ${duplicates}, skipped ${skipped}, without serving size ${noSize}, ${(text.length / 1024).toFixed(0)} KiB (chars)`)
