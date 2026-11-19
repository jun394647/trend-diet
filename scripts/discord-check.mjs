#!/usr/bin/env node
// 배포된 디스코드 연동을 실제로 한 번씩 불러 보는 수동 점검.
// 사용법: node scripts/discord-check.mjs <base-url> <cron-secret>
// 예:     node scripts/discord-check.mjs https://trend-diet.vercel.app s3cret
// 연결 작업(명령 등록, 주소 연결, 확인 메시지)과 아침·저녁 한마디를 차례로 부르고 받은 JSON을 그대로 보여 준다.
// 주인에게 디스코드 메시지가 세 건 가고, AI 횟수를 두 번 쓴다. 하나라도 실패하면 0이 아닌 코드로 끝난다.

const [baseArg, secret] = process.argv.slice(2)
if (!baseArg || !secret) {
  console.error('사용법: node scripts/discord-check.mjs <base-url> <cron-secret>')
  process.exit(2)
}
const base = baseArg.replace(/\/+$/, '')
const headers = { Authorization: `Bearer ${secret}` }

const steps = [
  { name: 'setup', method: 'POST', path: '/api/discord?setup=1' },
  { name: 'morning', method: 'GET', path: '/api/cron/coach?slot=morning' },
  { name: 'evening', method: 'GET', path: '/api/cron/coach?slot=evening' },
]

let failures = 0
for (const s of steps) {
  const started = Date.now()
  let status = 0
  let body
  try {
    const res = await fetch(`${base}${s.path}`, { method: s.method, headers, signal: AbortSignal.timeout(70_000) })
    status = res.status
    const text = await res.text()
    try {
      body = JSON.parse(text)
    } catch {
      body = text.slice(0, 300)
    }
  } catch (e) {
    body = String(e?.message ?? e)
  }
  const ok = status === 200 && body?.ok === true
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${s.name.padEnd(8)} HTTP ${status}  ${Date.now() - started}ms`)
  console.log(JSON.stringify(body, null, 2))
}

console.log(failures === 0 ? '모두 통과했어요.' : `${failures}건 실패했어요.`)
process.exit(failures === 0 ? 0 : 1)
