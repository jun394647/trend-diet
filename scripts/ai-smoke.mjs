#!/usr/bin/env node
// 배포된 /api/ai 를 실제로 한 번씩 불러 보는 수동 점검.
// 사용법: node scripts/ai-smoke.mjs <base-url> <supabase-access-token>
// 예:     node scripts/ai-smoke.mjs https://trend-diet.vercel.app eyJhbGciOi...
// GET 한 번, task마다 POST 한 번(하루 횟수 5회를 쓴다). 하나라도 실패하면 0이 아닌 코드로 끝난다.

const [baseArg, token] = process.argv.slice(2)
if (!baseArg || !token) {
  console.error('사용법: node scripts/ai-smoke.mjs <base-url> <supabase-access-token>')
  process.exit(2)
}
const endpoint = `${baseArg.replace(/\/+$/, '')}/api/ai`

// 64x64 단색(회청색) JPEG. 음식이 없으므로 빈 items와 설명이 돌아와야 한다.
const SAMPLE_JPEG =
  '/9j/4AAQSkZJRgABAQAASABIAAD/4QBMRXhpZgAATU0AKgAAAAgAAYdpAAQAAAABAAAAGgAAAAAAA6ABAAMAAAABAAEAAKACAAQAAAABAAAAQKADAAQAAAABAAAAQAAAAAD/7QA4UGhvdG9zaG9wIDMuMAA4QklNBAQAAAAAAAA4QklNBCUAAAAAABDUHYzZjwCyBOmACZjs+EJ+/8AAEQgAQABAAwEiAAIRAQMRAf/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/EAB8BAAMBAQEBAQEBAQEAAAAAAAABAgMEBQYHCAkKC//EALURAAIBAgQEAwQHBQQEAAECdwABAgMRBAUhMQYSQVEHYXETIjKBCBRCkaGxwQkjM1LwFWJy0QoWJDThJfEXGBkaJicoKSo1Njc4OTpDREVGR0hJSlNUVVZXWFlaY2RlZmdoaWpzdHV2d3h5eoKDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uLj5OXm5+jp6vLz9PX29/j5+v/bAEMABAQEBAQEBgQEBgkGBgYJDAkJCQkMDwwMDAwMDxIPDw8PDw8SEhISEhISEhUVFRUVFRkZGRkZHBwcHBwcHBwcHP/bAEMBBAUFBwcHDAcHDB0UEBQdHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHR0dHf/dAAQABP/aAAwDAQACEQMRAD8A6Siiivsj5sKKKKACiiigAooooA//0Okooor7I+bCiiigAooooAKKKKAP/9HpKKKK+yPmwooooAKKKKACiiigD//S6Siiivsj5sKKKKACiiigAooooA//2Q=='

function sampleContext() {
  const today = new Date()
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  const kcals = [1580, 1650, 2100, null, 1520, 1610, 1400, 1690, 1550, null, 1900, 1480, 1620, 900]
  const days = kcals.map((kcal, i) => {
    const d = new Date(today)
    d.setDate(d.getDate() - (kcals.length - 1 - i))
    return { date: iso(d), kcal, weightKg: i % 2 === 0 ? Math.round((67 - i * 0.06) * 10) / 10 : null }
  })
  return {
    today: iso(today),
    phase: 'lose',
    weekOfPhase: 3,
    breakUntil: null,
    sex: 'F',
    age: 34,
    heightCm: 162,
    startWeightKg: 68,
    goalWeightKg: 60,
    weeklyLossKg: 0.4,
    targetKcal: 1600,
    targetLow: 1500,
    targetHigh: 1700,
    estimatedTdee: 2040,
    trendKg: 66.2,
    weeklyRateKg: -0.35,
    todayKcal: 900,
    days,
    frequentMeals: [
      { name: '닭가슴살 샐러드', kcal: 350, count: 9 },
      { name: '김치찌개와 밥', kcal: 620, count: 6 },
      { name: '그릭요거트와 견과', kcal: 220, count: 5 },
    ],
    todayMeals: [
      { name: '그릭요거트와 견과', kcal: 220 },
      { name: '비빔밥', kcal: 680 },
    ],
  }
}

const isStr = (v) => typeof v === 'string'
const nonEmpty = (v) => isStr(v) && v.trim().length > 0
const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const short = (s, n = 70) => (s.length > n ? `${s.slice(0, n)}…` : s)

const mealItemsOk = (r) =>
  Array.isArray(r?.items) &&
  r.items.every((i) => nonEmpty(i.name) && isStr(i.amount) && isNum(i.kcal) && ['high', 'medium', 'low'].includes(i.confidence))
const mealView = (r) => [...r.items.map((i) => `${i.name} · ${i.amount} · ${i.kcal}kcal · ${i.confidence}`), `note: ${short(r.note)}`]

const ctx = sampleContext()
const cases = [
  {
    body: { task: 'meal-text', text: '점심에 김치찌개랑 밥 한 공기, 계란말이 조금' },
    check: (r) => (mealItemsOk(r) && r.items.length >= 2 && nonEmpty(r.note) ? null : '음식 항목이 2개 이상이고 note가 있어야 해요'),
    view: mealView,
  },
  {
    body: { task: 'meal-photo', imageBase64: SAMPLE_JPEG, mediaType: 'image/jpeg', note: '점검용 단색 사진' },
    check: (r) => (mealItemsOk(r) && r.items.length === 0 && nonEmpty(r.note) ? null : '음식이 없는 사진이라 items가 비고 note에 설명이 있어야 해요'),
    view: mealView,
  },
  {
    body: { task: 'week-review', context: ctx },
    check: (r) =>
      nonEmpty(r?.headline) && Array.isArray(r.wins) && r.wins.every(isStr) && Array.isArray(r.observations) && r.observations.every(isStr) && nonEmpty(r.nextStep)
        ? null
        : 'headline, wins, observations, nextStep이 있어야 해요',
    view: (r) => [
      `headline: ${short(r.headline)}`,
      ...r.wins.map((w) => `win: ${short(w)}`),
      ...r.observations.map((o) => `obs: ${short(o)}`),
      `next: ${short(r.nextStep)}`,
      `(${[r.headline, ...r.wins, ...r.observations, r.nextStep].join('').length}자)`,
    ],
  },
  {
    body: { task: 'suggest', context: ctx, wish: '따뜻한 국물' },
    check: (r) =>
      Array.isArray(r?.suggestions) && r.suggestions.length > 0 && r.suggestions.every((s) => nonEmpty(s.name) && isNum(s.kcal) && nonEmpty(s.why)) && isStr(r.note)
        ? null
        : '제안이 하나 이상 있고 각각 name, kcal, why가 있어야 해요',
    view: (r) => [...r.suggestions.map((s) => `${s.name} · ${s.kcal}kcal · ${short(s.why, 50)}`), `note: ${short(r.note)}`],
  },
  {
    body: {
      task: 'ask',
      context: ctx,
      question: '그럼 주말에 외식이 있으면 어떻게 하면 좋을까요',
      history: [
        { role: 'user', text: '그저께 많이 먹어서 걱정돼요' },
        { role: 'assistant', text: '하루 많이 먹은 날은 주 평균 안에서 보면 작은 일이에요. 이번 주 평균은 범위 근처예요.' },
      ],
    },
    check: (r) => (nonEmpty(r?.answer) ? null : 'answer가 있어야 해요'),
    view: (r) => [`answer: ${short(r.answer, 160)}`],
  },
]

let failures = 0
const report = (name, status, ms, problem, lines = []) => {
  if (problem) failures += 1
  console.log(`${problem ? 'FAIL' : 'ok  '} ${name.padEnd(12)} HTTP ${status}  ${ms}ms${problem ? `  → ${problem}` : ''}`)
  for (const line of lines) console.log(`       ${line}`)
}

async function timed(init) {
  const started = Date.now()
  try {
    const res = await fetch(endpoint, { ...init, signal: AbortSignal.timeout(70_000) })
    const text = await res.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    return { status: res.status, ms: Date.now() - started, body, text, cache: res.headers.get('cache-control') }
  } catch (e) {
    return { status: 0, ms: Date.now() - started, body: null, text: String(e?.message ?? e), cache: null }
  }
}

console.log(`대상: ${endpoint}`)

{
  const r = await timed({ method: 'GET' })
  let problem = null
  if (r.status !== 200 || !r.body) problem = `응답을 읽지 못했어요: ${short(r.text, 120)}`
  else if (r.body.configured !== true) problem = 'configured가 false예요. ANTHROPIC_API_KEY를 확인해 주세요'
  else if (!Number.isInteger(r.body.dailyLimit) || r.body.dailyLimit < 1) problem = 'dailyLimit이 이상해요'
  else if (r.cache !== 'no-store') problem = 'Cache-Control이 no-store가 아니에요'
  report('GET', r.status, r.ms, problem, r.body ? [JSON.stringify(r.body)] : [])
}

for (const c of cases) {
  const r = await timed({
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(c.body),
  })
  const b = r.body
  let problem = null
  let lines = []
  if (!b) problem = `JSON 응답이 아니에요: ${short(r.text, 120)}`
  else if (b.ok !== true) {
    problem = `error=${b.error}`
    if (b.usage) lines = [`usage: ${b.usage.used}/${b.usage.limit}`]
  } else if (r.status !== 200) problem = 'ok인데 HTTP 200이 아니에요'
  else if (!b.usage || !Number.isInteger(b.usage.used) || !Number.isInteger(b.usage.limit)) problem = 'usage가 없어요'
  else {
    try {
      problem = c.check(b.result)
      lines = [...c.view(b.result), `usage: ${b.usage.used}/${b.usage.limit}`]
    } catch (e) {
      problem = `결과 모양이 계약과 달라요: ${e?.message ?? e}`
      lines = [short(JSON.stringify(b.result), 200)]
    }
  }
  report(c.body.task, r.status, r.ms, problem, lines)
}

console.log(failures === 0 ? '모두 통과했어요.' : `${failures}건 실패했어요.`)
process.exit(failures === 0 ? 0 : 1)
