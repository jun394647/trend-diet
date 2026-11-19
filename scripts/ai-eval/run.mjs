#!/usr/bin/env node
// task별로 모델·effort 후보를 같은 입력에 돌려 속도, 품질, 비용을 나란히 본다.
// 요청은 서버 코드(server/ai/model.ts의 buildStreamParams)가 만드는 것을 그대로 쓰므로, 앱이 보내는 것과 같다.
//
//   node scripts/ai-eval/run.mjs                  계획만 보여 준다. 아무것도 보내지 않는다.
//   node scripts/ai-eval/run.mjs --selftest       채점 규칙이 좋은 답과 나쁜 답을 가르는지 본다. 아무것도 보내지 않는다.
//   node scripts/ai-eval/run.mjs --yes            실제로 부른다(돈이 든다). ANTHROPIC_API_KEY가 있어야 한다.
//
//   --budget 1.00        쓸 수 있는 돈(USD). 넘기 전에 멈춘다. 기본 1.00.
//   --tasks a,b          볼 task. 기본: meal-text,suggest,ask,week-review,nudge
//   --candidates x,y     볼 후보(아래 CANDIDATES의 이름). 기본: task마다 정해 둔 것.
//   --repeats 1          입력마다 후보를 몇 번 부를지. 기본 1.
//   --noise              지금 설정을 한 번 더 불러, 같은 설정끼리의 차이(잡음)를 잰다.
//
// 결과는 scripts/ai-eval/results/<시각>.json 에 남는다(받은 글 전체 포함). 표는 화면에 찍는다.
// 잴 때의 원칙: 후보와 지금 설정을 같은 실행 안에서, 같은 입력에, 번갈아 부른다. 다른 날 잰 숫자와 비교하지 않는다.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { MODEL_RULES, TASK_DEFAULTS, buildStreamParams, tidyResult } from '../../server/ai/model.ts'
import { ASK, MEAL_TEXT, NUDGE, SUGGEST, WEEK_REVIEW } from './cases.mjs'
import { GRADERS, score } from './graders.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

// USD / 백만 토큰. 2026-11-19에 https://platform.claude.com/docs/en/about-claude/pricing 에서 읽은 값.
// fast는 https://platform.claude.com/docs/en/build-with-claude/fast-mode 의 표(Opus 5.5: 8 / 40).
const PRICE = {
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
}
const FAST_MULTIPLIER = 2

// 후보. base는 TASK_DEFAULTS(지금 쓰는 설정)이고, 나머지는 그 위에 덮어쓴다.
const CANDIDATES = {
  base: {},
  'opus-low': { model: 'claude-opus-5-5', effort: 'low' },
  'opus-fast': { model: 'claude-opus-5-5', speed: 'fast' },
  'sonnet-low': { model: 'claude-sonnet-5-5', effort: 'low' },
  'sonnet-medium': { model: 'claude-sonnet-5-5', effort: 'medium' },
  'haiku-low': { model: 'claude-haiku-5-5', effort: 'low' },
  'haiku-medium': { model: 'claude-haiku-5-5', effort: 'medium' },
  'haiku-low-nothink': { model: 'claude-haiku-5-5', effort: 'low', thinking: 'off' },
  'sonnet-low-nothink': { model: 'claude-sonnet-5-5', effort: 'low', thinking: 'off' },
}

// task마다 볼 후보와 입력. 가벼운 추출 일에는 작은 모델을, 줄글에는 한 단계 아래와 낮은 effort를 본다.
const PLAN = {
  'meal-text': { cases: MEAL_TEXT.map((c) => ({ ...c, request: { text: c.text } })), candidates: ['base', 'sonnet-low', 'haiku-low', 'haiku-low-nothink', 'haiku-medium'] },
  suggest: { cases: SUGGEST, candidates: ['base', 'sonnet-low', 'haiku-low', 'haiku-medium'] },
  ask: { cases: ASK, candidates: ['base', 'opus-low', 'sonnet-medium', 'sonnet-low', 'opus-fast'] },
  'week-review': { cases: WEEK_REVIEW, candidates: ['base', 'opus-low', 'sonnet-medium'] },
  nudge: { cases: NUDGE, candidates: ['base', 'sonnet-low', 'haiku-low'] },
}
// 사진(meal-photo)은 실제 음식 사진이 있어야 볼 수 있다. 저장소에 사진을 두지 않으므로 여기서는 보지 않는다.

// 한 번 부를 때 들 수 있는 돈을 넉넉히 잡은 것(입력 3,200토큰, 출력 1,500토큰). 예산을 넘지 않게 미리 떼어 둔다.
const RESERVE_TOKENS = { in: 3200, out: 1500 }

function args() {
  const a = process.argv.slice(2)
  const flag = (name) => a.includes(`--${name}`)
  const value = (name, fallback) => {
    const i = a.indexOf(`--${name}`)
    return i >= 0 && a[i + 1] ? a[i + 1] : fallback
  }
  return {
    yes: flag('yes'),
    selftest: flag('selftest'),
    noise: flag('noise'),
    budget: Number(value('budget', '1.00')),
    repeats: Math.max(1, Number.parseInt(value('repeats', '1'), 10) || 1),
    tasks: value('tasks', Object.keys(PLAN).join(',')).split(',').filter((t) => PLAN[t]),
    candidates: value('candidates', '').split(',').filter((c) => CANDIDATES[c]),
  }
}

const configFor = (task, name) => ({ ...TASK_DEFAULTS[task], ...CANDIDATES[name] })
const describe = (c) =>
  `${c.model.replace('claude-', '')}/${c.effort}${c.thinking === 'off' && MODEL_RULES[c.model].thinkingOff ? '/생각 끔' : ''}${c.speed === 'fast' && MODEL_RULES[c.model].fastMode ? '/fast' : ''}`

function cost(config, usage) {
  const p = PRICE[config.model]
  const k = config.speed === 'fast' && MODEL_RULES[config.model].fastMode ? FAST_MULTIPLIER : 1
  return (
    (k *
      ((usage.input_tokens ?? 0) * p.in +
        (usage.output_tokens ?? 0) * p.out +
        (usage.cache_read_input_tokens ?? 0) * p.cacheRead +
        (usage.cache_creation_input_tokens ?? 0) * p.cacheWrite)) /
    1e6
  )
}
const reserve = (config) => cost(config, { input_tokens: RESERVE_TOKENS.in, output_tokens: RESERVE_TOKENS.out })

const median = (xs) => {
  const s = xs.filter((x) => typeof x === 'number').sort((a, b) => a - b)
  if (s.length === 0) return null
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}
const sec = (ms) => (ms === null || ms === undefined ? '   -  ' : `${(ms / 1000).toFixed(2)}s`.padStart(6))
const usd = (n) => `$${n.toFixed(4)}`

/** 한 번 부른다. 앱과 같은 요청을 조금씩 받아, 첫 조각·첫 글자·끝의 시각과 토큰 수를 잰다. */
async function callOnce(client, task, config, request) {
  const params = buildStreamParams({ task, ...request }, config)
  const t0 = performance.now()
  let firstEvent = null
  let firstText = null
  let text = ''
  try {
    const stream = client.beta.messages.stream(params, { signal: AbortSignal.timeout(60_000) })
    for await (const event of stream) {
      firstEvent ??= performance.now() - t0
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        firstText ??= performance.now() - t0
        text += event.delta.text
      }
    }
    const message = await stream.finalMessage()
    const total = performance.now() - t0
    let parsed = null
    try {
      parsed = JSON.parse(message.content.map((b) => (b.type === 'text' ? b.text : '')).join(''))
    } catch {
      parsed = null
    }
    const result = message.stop_reason === 'end_turn' && parsed ? tidyResult(task, parsed) : null
    return { ok: Boolean(result), stop: message.stop_reason, servedBy: message.model, firstEvent, firstText, total, usage: message.usage, result, spent: cost(config, message.usage) }
  } catch (e) {
    // 실패한 호출도 입력만큼은 돈이 들었을 수 있다. 넉넉히 떼어 둔 만큼 쓴 것으로 친다.
    return { ok: false, error: `${e?.constructor?.name ?? 'Error'}: ${String(e?.message ?? e).slice(0, 200)}`, total: performance.now() - t0, firstEvent, firstText, usage: {}, result: null, spent: reserve(config) }
  }
}

function plan(opts) {
  const rows = []
  for (const task of opts.tasks) {
    const names = (opts.candidates.length > 0 ? ['base', ...opts.candidates.filter((c) => c !== 'base')] : PLAN[task].candidates).filter(
      // 같은 요청이 되는 후보는 한 번만 본다(예: 이미 low인 task의 opus-low).
      (name, i, all) => all.findIndex((n) => JSON.stringify(configFor(task, n)) === JSON.stringify(configFor(task, name))) === i,
    )
    if (opts.noise) names.push('base#2')
    for (const name of names) {
      const config = configFor(task, name.replace('#2', ''))
      rows.push({ task, name, config, calls: PLAN[task].cases.length * opts.repeats, worst: reserve(config) * PLAN[task].cases.length * opts.repeats })
    }
  }
  return rows
}

function printPlan(rows, opts) {
  console.log('계획 (아직 아무것도 보내지 않았어요)\n')
  for (const r of rows) console.log(`  ${r.task.padEnd(12)} ${r.name.padEnd(20)} ${describe(r.config).padEnd(28)} ${String(r.calls).padStart(3)}번  최대 ${usd(r.worst)}`)
  const calls = rows.reduce((s, r) => s + r.calls, 0)
  const worst = rows.reduce((s, r) => s + r.worst, 0)
  console.log(`\n  모두 ${calls}번, 넉넉히 잡아 최대 ${usd(worst)} (예산 ${usd(opts.budget)}). 예산에 닿으면 남은 호출은 건너뛰어요.`)
  console.log('  인증: ANTHROPIC_API_KEY (SDK 기본값), 주소: https://api.anthropic.com (ANTHROPIC_BASE_URL이 있으면 그 주소)')
  console.log('  실제로 부르려면 --yes 를 붙여 주세요.')
}

async function run(opts) {
  const rows = plan(opts)
  if (!opts.yes) return printPlan(rows, opts)

  let client
  try {
    client = new Anthropic({ maxRetries: 0, timeout: 60_000 })
  } catch (e) {
    console.error(`인증 정보를 찾지 못했어요: ${String(e?.message ?? e).slice(0, 160)}\nANTHROPIC_API_KEY를 이 셸에 설정한 뒤 다시 실행해 주세요. 아무것도 보내지 않았어요.`)
    process.exit(2)
  }

  let spent = 0
  let skipped = 0
  const records = []
  for (const task of opts.tasks) {
    const mine = rows.filter((r) => r.task === task)
    // 구조화 출력은 스키마를 처음 쓸 때 준비 시간이 든다. 모델마다 한 번 불러 두고 그 호출은 재지 않는다.
    for (const model of new Set(mine.map((r) => r.config.model))) {
      const config = mine.find((r) => r.config.model === model).config
      if (spent + reserve(config) > opts.budget) continue
      const warm = await callOnce(client, task, config, PLAN[task].cases[0].request)
      spent += warm.spent
    }
    for (let rep = 0; rep < opts.repeats; rep++) {
      for (const [i, c] of PLAN[task].cases.entries()) {
        // 입력마다 후보의 순서를 한 칸씩 돌려, 시간에 따른 속도 변화가 한 후보에만 쏠리지 않게 한다.
        const order = mine.map((_, k) => mine[(k + i + rep) % mine.length])
        for (const r of order) {
          if (spent + reserve(r.config) > opts.budget) {
            skipped++
            continue
          }
          const out = await callOnce(client, task, r.config, c.request)
          spent += out.spent
          const checks = out.result ? GRADERS[task](c, out.result) : [{ name: '답을 받음', ok: false, detail: out.error ?? out.stop }]
          records.push({ task, case: c.id, candidate: r.name, config: r.config, ...out, checks, score: score(checks) })
          const failed = checks.filter((x) => !x.ok).map((x) => `${x.name}${x.detail ? `(${x.detail})` : ''}`)
          console.log(
            `${task.padEnd(12)} ${c.id.padEnd(26)} ${r.name.padEnd(20)} 첫 글자 ${sec(out.firstText)}  전체 ${sec(out.total)}  out ${String(out.usage?.output_tokens ?? '-').padStart(4)}  ${usd(out.spent)}  ${(score(checks) * 100).toFixed(0).padStart(3)}%${failed.length ? `  ✗ ${failed.join(' · ')}` : ''}`,
          )
        }
      }
    }
  }

  console.log('\n── 요약 (중앙값. 비는 같은 실행 안의 base에 대한 전체 시간의 비) ──')
  console.log(`${'task'.padEnd(12)} ${'후보'.padEnd(20)} ${'설정'.padEnd(28)}   n  품질  완벽  첫 글자   전체     비   in   out  호출당`)
  const summary = []
  for (const task of opts.tasks) {
    const of = (name) => records.filter((r) => r.task === task && r.candidate === name)
    const baseTotal = median(of('base').map((r) => r.total))
    for (const r of rows.filter((x) => x.task === task)) {
      const rs = of(r.name)
      if (rs.length === 0) continue
      const row = {
        task,
        candidate: r.name,
        setting: describe(r.config),
        n: rs.length,
        quality: rs.reduce((s, x) => s + x.score, 0) / rs.length,
        perfect: rs.filter((x) => x.score === 1).length,
        firstTextMs: median(rs.map((x) => x.firstText)),
        totalMs: median(rs.map((x) => x.total)),
        ratio: baseTotal ? median(rs.map((x) => x.total)) / baseTotal : null,
        inTokens: median(rs.map((x) => x.usage?.input_tokens)),
        outTokens: median(rs.map((x) => x.usage?.output_tokens)),
        costPerCall: rs.reduce((s, x) => s + x.spent, 0) / rs.length,
      }
      summary.push(row)
      console.log(
        `${task.padEnd(12)} ${r.name.padEnd(20)} ${row.setting.padEnd(28)} ${String(row.n).padStart(3)}  ${(row.quality * 100).toFixed(0).padStart(3)}%  ${String(row.perfect).padStart(2)}/${row.n}  ${sec(row.firstTextMs)}  ${sec(row.totalMs)}  ${row.ratio ? `x${row.ratio.toFixed(2)}` : '  -  '} ${String(row.inTokens ?? '-').padStart(5)} ${String(row.outTokens ?? '-').padStart(5)}  ${usd(row.costPerCall)}`,
      )
    }
  }
  console.log(`\n쓴 돈: ${usd(spent)} / 예산 ${usd(opts.budget)}${skipped ? ` · 예산 때문에 건너뛴 호출 ${skipped}번` : ''}`)
  console.log('줄글(ask, week-review, nudge)은 규칙 점수만으로 정하지 말고, 결과 파일의 글을 README의 기준으로 읽어 보세요.')

  mkdirSync(join(HERE, 'results'), { recursive: true })
  const file = join(HERE, 'results', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`)
  writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), node: process.version, options: opts, spent, skipped, prices: PRICE, summary, records }, null, 2))
  console.log(`결과 파일: ${file}`)
}

/** 채점 규칙이 좋은 답은 통과시키고 나쁜 답은 잡아내는지. */
function selftest() {
  const meal = MEAL_TEXT[0]
  const goodMeal = {
    items: [
      { name: '김치찌개', amount: '1인분', kcal: 250, confidence: 'medium' },
      { name: '밥', amount: '1공기(210g)', kcal: 310, confidence: 'high' },
      { name: '계란말이', amount: '2~3조각', kcal: 100, confidence: 'low' },
    ],
    note: '찌개와 계란말이는 양이 적혀 있지 않아 흔한 1인분과 조금으로 가정했어요.',
  }
  const badMeal = { items: [{ name: '김치찌개 정식', amount: '', kcal: 1555, confidence: 'high' }], note: 'Great choice!' }
  const sug = SUGGEST[0]
  const goodSug = {
    suggestions: [
      { name: '김치찌개와 밥 반 공기', kcal: 480, why: '자주 드시는 메뉴라 부담이 적어요.' },
      { name: '순두부찌개와 밥 반 공기', kcal: 450, why: '따뜻한 국물이면서 범위 안에 들어와요.' },
      { name: '닭고기 쌀국수', kcal: 520, why: '국물이 있고 단백질도 챙길 수 있어요.' },
    ],
    note: '오늘은 600~800kcal 정도 남았어요.',
  }
  const badSug = { suggestions: [{ name: '치킨 한 마리', kcal: 1800, why: '맛있어요!' }], note: '' }
  const goodAsk = { answer: '굳이 메울 필요는 없어요. 그저께 2100kcal을 드셨어도 최근 7일 평균은 범위 근처예요. 오늘은 평소처럼 1500~1700kcal 안에서 드시면 돼요.' }
  const badAsk = { answer: '**반드시** 오늘 덜 드세요! 의지가 부족하면 실패합니다.' }
  const goodWeek = { headline: '주 평균이 범위 안이었어요.', wins: ['6일을 기록했어요.'], observations: ['토요일에 범위보다 높았어요.'], nextStep: '이번 주에도 아침을 기록해 보세요.' }
  const badWeek = { headline: '최고의 한 주!', wins: [], observations: ['a', 'b', 'c', 'd'], nextStep: '목표 칼로리를 낮추세요.' }
  const table = [
    ['meal-text 좋은 답', GRADERS['meal-text'](meal, goodMeal), true],
    ['meal-text 나쁜 답', GRADERS['meal-text'](meal, badMeal), false],
    ['meal-text 음식 아님(좋은 답)', GRADERS['meal-text'](MEAL_TEXT[7], { items: [], note: '음식 이야기가 아니라서 추정하지 못했어요.' }), true],
    ['meal-text 음식 아님(지어냄)', GRADERS['meal-text'](MEAL_TEXT[7], goodMeal), false],
    ['suggest 좋은 답', GRADERS.suggest(sug, goodSug), true],
    ['suggest 나쁜 답', GRADERS.suggest(sug, badSug), false],
    ['ask 좋은 답', GRADERS.ask(ASK[0], goodAsk), true],
    ['ask 나쁜 답', GRADERS.ask(ASK[0], badAsk), false],
    ['week-review 좋은 답', GRADERS['week-review'](WEEK_REVIEW[1], goodWeek), true],
    ['week-review 나쁜 답', GRADERS['week-review'](WEEK_REVIEW[1], badWeek), false],
  ]
  let wrong = 0
  for (const [name, checks, shouldPass] of table) {
    const s = score(checks)
    const ok = shouldPass ? s === 1 : s < 0.8
    if (!ok) wrong++
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(28)} ${(s * 100).toFixed(0).padStart(3)}%  ${checks.filter((c) => !c.ok).map((c) => c.name).join(' · ')}`)
  }
  // 요청도 만들어 본다(네트워크 없이). 모든 입력이 서버 코드로 요청이 되는지.
  let built = 0
  for (const [task, p] of Object.entries(PLAN)) {
    for (const c of p.cases) for (const name of p.candidates) built += buildStreamParams({ task, ...c.request }, configFor(task, name)).messages.length > 0 ? 1 : 0
  }
  console.log(`요청 ${built}개를 만들어 봤어요.`)
  process.exit(wrong === 0 ? 0 : 1)
}

const opts = args()
if (opts.selftest) selftest()
else await run(opts)
