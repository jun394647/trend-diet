/**
 * POST /api/discord 의 본체: 디스코드가 보내는 HTTP 상호작용(슬래시 명령, 버튼)을 처리한다.
 * 디스코드는 3초 안에 답을 받아야 하므로, 명령은 모두 먼저 '미뤄 둔 응답'으로 답하고
 * 실제 일은 waitUntil 안에서 한 뒤 원래 응답을 고친다. 무슨 일이 있어도 원래 응답은 고쳐 놓는다.
 * 로그에는 무슨 일을 했고 얼마나 걸렸고 어떻게 끝났는지만 남긴다. 적은 글과 토큰은 남기지 않는다.
 */
import { buildCoachContext } from '../../src/ai/context.ts'
import { AnswerSchema, MealEstimateSchema, type AiErrorCode, type AiRequest } from '../../src/ai/contract.ts'
import { formatKorean } from '../../src/lib/date.ts'
import { mealsOn, weightOn } from '../../src/lib/selectors.ts'
import { computeTrend, trendAt } from '../../src/lib/trend.ts'
import type { MealEntry, WeightEntry } from '../../src/types.ts'
import { dailyLimit } from '../ai/handler.ts'
import type { CallModel } from '../ai/model.ts'
import {
  DataError,
  dataConfig,
  findMealsByBatch,
  kstToday,
  loadUserData,
  markDeleted,
  takeAiUse,
  upsertRecords,
  type DataConfig,
  type Env,
} from '../data/records.ts'
import { editOriginal } from './api.ts'
import { CMD, MAX_KG, MIN_KG, OPT, UNDO_PREFIX } from './commands.ts'
import { MSG, dayStatus, fitMessage, fmtKcal, fmtKg, headline, onboarded, plain, todayLine, weekLine } from './text.ts'
import { verifyDiscordSignature } from './verify.ts'

export interface DiscordDeps {
  env: Env
  fetch: typeof fetch
  callModel: CallModel
  now: () => Date
  /** 응답을 돌려준 뒤에도 함수가 이 약속이 끝날 때까지 살아 있게 한다(@vercel/functions의 waitUntil). */
  waitUntil: (promise: Promise<unknown>) => void
}

/** 사진 한 장의 최대 크기(바이트). 앱의 사진 기록과 같은 약 3MB. */
export const MAX_PHOTO_BYTES = 3_000_000
const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
type PhotoType = (typeof PHOTO_TYPES)[number]
/** 한 번에 기록하는 음식 수와 한 항목의 칼로리 범위(앱의 직접 입력과 같다). */
const MAX_ITEMS = 20
const MIN_ITEM_KCAL = 1
const MAX_ITEM_KCAL = 5000

const EPHEMERAL = 64
const value = (s: string | undefined): string => (s ?? '').trim()

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/** 바로 보이는 답. 본인에게만 보인다. */
const ephemeral = (content: string): Response => json({ type: 4, data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } } })

// ── 상호작용 본문에서 필요한 것만 꺼낸다 ─────────────────────────────

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function callerId(interaction: Obj): string {
  const member = isObj(interaction.member) ? interaction.member : null
  const user = member && isObj(member.user) ? member.user : isObj(interaction.user) ? interaction.user : null
  return user ? str(user.id) : ''
}

function option(data: Obj, name: string): unknown {
  const options = Array.isArray(data.options) ? data.options : []
  for (const o of options) if (isObj(o) && o.name === name) return o.value
  return undefined
}

interface Attachment {
  url: string
  contentType: string
  size: number
}

function attachment(data: Obj, id: unknown): Attachment | null {
  if (typeof id !== 'string' || !isObj(data.resolved) || !isObj(data.resolved.attachments)) return null
  const a = data.resolved.attachments[id]
  if (!isObj(a) || !str(a.url)) return null
  return { url: str(a.url), contentType: str(a.content_type).split(';')[0].trim().toLowerCase(), size: typeof a.size === 'number' ? a.size : 0 }
}

// ── 일의 결과 ────────────────────────────────────────────────────

interface Outcome {
  content: string
  components?: unknown[]
  /** 로그에 남기는 짧은 결과 이름. */
  result: string
}

const done = (content: string, result: string, components?: unknown[]): Outcome => ({ content, result, components })

function aiMessage(error: AiErrorCode): string {
  if (error === 'busy') return MSG.aiBusy
  if (error === 'refused') return MSG.aiRefused
  if (error === 'limit') return MSG.limit
  if (error === 'not_configured') return MSG.aiOff
  return MSG.aiFailed
}

interface Ctx {
  deps: DiscordDeps
  cfg: DataConfig
  today: string
}

/** 횟수를 하나 쓰고 Claude를 부른다. 결과 또는 사용자에게 보여 줄 실패 안내를 돌려준다. */
async function askModel(ctx: Ctx, request: AiRequest): Promise<{ ok: true; result: unknown } | { ok: false; outcome: Outcome }> {
  const { deps, cfg } = ctx
  if (!value(deps.env.ANTHROPIC_API_KEY)) return { ok: false, outcome: done(MSG.aiOff, 'ai_not_configured') }
  const count = await takeAiUse(deps.fetch, cfg, dailyLimit(deps.env))
  // 횟수를 확인하지 못하면 Claude를 부르지 않는다.
  if (count === null) return { ok: false, outcome: done(MSG.db, 'usage_failed') }
  if (count === -1) return { ok: false, outcome: done(MSG.limit, 'limit') }
  let outcome: Awaited<ReturnType<CallModel>>
  try {
    outcome = await deps.callModel({ request, userId: cfg.userId })
  } catch {
    outcome = { ok: false, error: 'failed' }
  }
  if (!outcome.ok) return { ok: false, outcome: done(aiMessage(outcome.error), `ai_${outcome.error}`) }
  return { ok: true, result: outcome.result }
}

async function readPhoto(
  fetchFn: typeof fetch,
  a: Attachment,
): Promise<{ ok: true; base64: string; mediaType: PhotoType } | { ok: false; outcome: Outcome }> {
  const mediaType = PHOTO_TYPES.find((t) => t === a.contentType)
  if (!mediaType) return { ok: false, outcome: done(MSG.photoUnreadable, 'photo_type') }
  if (a.size > MAX_PHOTO_BYTES) return { ok: false, outcome: done(MSG.photoTooBig, 'photo_too_big') }
  let host = ''
  try {
    const u = new URL(a.url)
    host = u.protocol === 'https:' ? u.hostname : ''
  } catch {
    host = ''
  }
  // 첨부 파일은 디스코드의 저장소에서만 받는다.
  if (!/(^|\.)(discordapp\.com|discordapp\.net|discord\.com)$/.test(host)) return { ok: false, outcome: done(MSG.photoUnreadable, 'photo_host') }
  try {
    const res = await fetchFn(a.url, { method: 'GET', signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return { ok: false, outcome: done(MSG.photoUnreadable, 'photo_fetch') }
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, outcome: done(MSG.photoTooBig, 'photo_too_big') }
    if (bytes.length < 100) return { ok: false, outcome: done(MSG.photoUnreadable, 'photo_empty') }
    return { ok: true, base64: bytes.toString('base64'), mediaType }
  } catch {
    return { ok: false, outcome: done(MSG.photoUnreadable, 'photo_fetch') }
  }
}

// ── 명령 ────────────────────────────────────────────────────────

/** 디스코드에서 기록한 식사에는 묶음 키를 함께 적어 둔다. 취소 버튼이 이 키로 방금 기록한 것들을 찾는다. */
type BotMeal = MealEntry & { batch: string }

async function ate(ctx: Ctx, data: Obj): Promise<Outcome> {
  const { deps, cfg, today } = ctx
  const user = await loadUserData(deps.fetch, cfg)
  const ready = onboarded(user)
  if (!ready) return done(MSG.notOnboarded, 'not_onboarded')

  const text = str(option(data, OPT.text)).trim()
  if (!text) return done(MSG.emptyText, 'empty')

  let request: AiRequest
  const photoId = option(data, OPT.photo)
  if (photoId !== undefined) {
    const a = attachment(data, photoId)
    if (!a) return done(MSG.photoUnreadable, 'photo_missing')
    // 사진을 먼저 확인한다. 읽지 못할 사진에 AI 횟수를 쓰지 않는다.
    const photo = await readPhoto(deps.fetch, a)
    if (!photo.ok) return photo.outcome
    request = { task: 'meal-photo', imageBase64: photo.base64, mediaType: photo.mediaType, note: text.slice(0, 200) }
  } else {
    request = { task: 'meal-text', text: text.slice(0, 500) }
  }

  const answer = await askModel(ctx, request)
  if (!answer.ok) return answer.outcome
  const parsed = MealEstimateSchema.safeParse(answer.result)
  if (!parsed.success) return done(MSG.aiFailed, 'ai_shape')
  const note = plain(parsed.data.note)
  const items = parsed.data.items
    .map((it) => ({ name: it.name.trim().slice(0, 40), amount: it.amount.trim(), kcal: Math.round(it.kcal) }))
    .filter((it) => it.name && it.kcal >= MIN_ITEM_KCAL && it.kcal <= MAX_ITEM_KCAL)
    .slice(0, MAX_ITEMS)
  if (items.length === 0) return done(note ? `${MSG.noFood}\n${note}` : MSG.noFood, 'no_food')

  const batch = crypto.randomUUID().replaceAll('-', '').slice(0, 16)
  const at = deps.now().getTime()
  // 적은 순서대로 보이도록 기록 시각을 1ms씩 벌린다.
  const meals: BotMeal[] = items.map((it, i) => ({
    id: crypto.randomUUID(),
    date: today,
    name: it.name,
    kcal: it.kcal,
    source: 'ai',
    createdAt: new Date(at + i).toISOString(),
    batch,
  }))
  await upsertRecords(
    deps.fetch,
    cfg,
    meals.map((m) => ({ kind: 'meal', key: m.id, data: m })),
  )

  const status = dayStatus({ ...user, meals: [...user.meals, ...meals] }, ready.profile, ready.plan, today)
  const total = items.reduce((s, it) => s + it.kcal, 0)
  const lines = [
    '기록했어요.',
    ...items.map((it) => `${plain(it.name)} · ${plain(it.amount) || '양 모름'} · ${fmtKcal(it.kcal)} kcal`),
    `합계 ${fmtKcal(total)} kcal`,
    ...(note ? [note] : []),
    '',
    headline(status),
    todayLine(status),
  ]
  const button = { type: 1, components: [{ type: 2, style: 2, label: '방금 기록 취소', custom_id: `${UNDO_PREFIX}${batch}` }] }
  return done(fitMessage(lines.join('\n')), 'ok', [button])
}

async function undo(ctx: Ctx, batch: string): Promise<Outcome> {
  const { deps, cfg } = ctx
  if (!/^[0-9a-f]{8,32}$/.test(batch)) return done(MSG.undoMissing, 'undo_bad_key')
  const rows = await findMealsByBatch(deps.fetch, cfg, batch)
  if (rows.length === 0) return done(MSG.undoMissing, 'undo_missing')
  const live = rows.filter((r) => !r.deleted)
  await markDeleted(
    deps.fetch,
    cfg,
    'meal',
    live.map((r) => r.key),
  )
  const lines = [...rows.map((r) => `~~${plain(r.meal.name ?? '식사')} · ${fmtKcal(r.meal.kcal)} kcal~~`), MSG.undone]
  return done(fitMessage(lines.join('\n')), live.length > 0 ? 'undone' : 'already_undone')
}

async function weight(ctx: Ctx, data: Obj): Promise<Outcome> {
  const { deps, cfg, today } = ctx
  const user = await loadUserData(deps.fetch, cfg)
  if (!onboarded(user)) return done(MSG.notOnboarded, 'not_onboarded')
  const raw = option(data, OPT.kg)
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < MIN_KG || raw > MAX_KG) return done(MSG.badKg, 'bad_kg')
  const entry: WeightEntry = { date: today, kg: Math.round(raw * 10) / 10 }
  const before = weightOn(user.weights, today)
  await upsertRecords(deps.fetch, cfg, [{ kind: 'weight', key: today, data: entry }])
  const trend = trendAt(computeTrend([...user.weights.filter((w) => w.date !== today), entry]), today)
  const first =
    before !== null && before !== entry.kg
      ? `오늘 체중을 ${fmtKg(entry.kg)} kg으로 고쳐 기록했어요.`
      : `오늘 체중 ${fmtKg(entry.kg)} kg을 기록했어요.`
  return done(trend === null ? first : `${first} 추세 체중은 ${fmtKg(trend)} kg이에요.`, 'ok')
}

async function todayView(ctx: Ctx): Promise<Outcome> {
  const { deps, cfg, today } = ctx
  const user = await loadUserData(deps.fetch, cfg)
  const ready = onboarded(user)
  if (!ready) return done(MSG.notOnboarded, 'not_onboarded')
  const status = dayStatus(user, ready.profile, ready.plan, today)
  const meals = mealsOn(user.meals, today)
  const kg = weightOn(user.weights, today)
  const lines = [
    formatKorean(today),
    headline(status),
    todayLine(status),
    '',
    ...(meals.length === 0
      ? ['오늘은 아직 기록한 식사가 없어요.']
      : ['오늘 기록한 식사', ...meals.map((m) => `${plain(m.name ?? (m.source === 'rough' ? '대충 기록' : '식사'))} · ${fmtKcal(m.kcal)} kcal`)]),
    '',
    `이번 주 식사 기록 ${status.week.mealDays}일 · ${weekLine(status.week, status.rangeName)}`,
    kg === null ? '오늘 체중은 아직 기록하지 않았어요.' : `오늘 체중 ${fmtKg(kg)} kg을 기록했어요.`,
  ]
  return done(fitMessage(lines.join('\n')), 'ok')
}

async function coach(ctx: Ctx, data: Obj): Promise<Outcome> {
  const { deps, cfg, today } = ctx
  const user = await loadUserData(deps.fetch, cfg)
  const ready = onboarded(user)
  const context = ready ? buildCoachContext({ ...user, profile: ready.profile, asOf: today }) : null
  if (!context) return done(MSG.notOnboarded, 'not_onboarded')
  const question = str(option(data, OPT.question)).trim().slice(0, 500)
  if (!question) return done(MSG.emptyQuestion, 'empty')
  const answer = await askModel(ctx, { task: 'ask', context, question, history: [] })
  if (!answer.ok) return answer.outcome
  const parsed = AnswerSchema.safeParse(answer.result)
  if (!parsed.success || !parsed.data.answer.trim()) return done(MSG.aiFailed, 'ai_shape')
  return done(fitMessage(parsed.data.answer), 'ok')
}

// ── 미뤄 둔 일을 끝내고 원래 응답을 고친다 ─────────────────────────────

async function finish(
  deps: DiscordDeps,
  task: string,
  applicationId: string,
  token: string,
  work: () => Promise<Outcome>,
): Promise<void> {
  const started = Date.now()
  let outcome: Outcome
  try {
    outcome = await work()
  } catch (e) {
    outcome = e instanceof DataError ? done(MSG.db, `data_${e.step}_${e.status}`) : done(MSG.failed, 'threw')
  }
  let edit = await editOriginal(deps.fetch, applicationId, token, { content: outcome.content, components: outcome.components })
  if (!edit.ok && edit.status !== 404) {
    // 고친 글을 디스코드가 받지 않았으면 짧은 안내로 한 번 더 시도해 '생각 중'이 남지 않게 한다.
    const retry = await editOriginal(deps.fetch, applicationId, token, { content: outcome.result === 'ok' ? MSG.doneUnshown : MSG.failed })
    edit = retry.ok ? retry : edit
  }
  console.log(JSON.stringify({ evt: 'discord', task, ms: Date.now() - started, result: outcome.result, edit: edit.status }))
}

export async function handleInteraction(request: Request, deps: DiscordDeps): Promise<Response> {
  const { env } = deps
  const publicKey = value(env.DISCORD_PUBLIC_KEY)
  if (!publicKey) return json({ ok: false, error: 'not_configured' }, 503)

  // 서명은 받은 글자 그대로에 대한 것이라 JSON으로 풀기 전에 본문을 글자로 읽는다.
  const raw = await request.text()
  const valid = await verifyDiscordSignature({
    publicKey,
    signature: request.headers.get('x-signature-ed25519'),
    timestamp: request.headers.get('x-signature-timestamp'),
    body: raw,
  })
  if (!valid) return json({ ok: false, error: 'invalid_signature' }, 401)

  let interaction: unknown
  try {
    interaction = JSON.parse(raw)
  } catch {
    interaction = null
  }
  if (!isObj(interaction)) return json({ ok: false, error: 'bad_request' }, 400)
  if (interaction.type === 1) return json({ type: 1 })

  const ownerId = value(env.DISCORD_OWNER_ID)
  if (!ownerId) return json({ ok: false, error: 'not_configured' }, 503)
  if (callerId(interaction) !== ownerId) return ephemeral(MSG.notOwner)

  const cfg = dataConfig(env)
  const applicationId = str(interaction.application_id) || value(env.DISCORD_APPLICATION_ID)
  const token = str(interaction.token)
  if (!cfg || !applicationId || !token) return ephemeral(MSG.notConfigured)

  const data = isObj(interaction.data) ? interaction.data : {}
  const ctx: Ctx = { deps, cfg, today: kstToday(deps.now()) }
  const defer = (task: string, type: 5 | 6, work: () => Promise<Outcome>): Response => {
    deps.waitUntil(finish(deps, task, applicationId, token, work))
    return json({ type })
  }

  if (interaction.type === 2) {
    switch (data.name) {
      case CMD.ate:
        return defer('ate', 5, () => ate(ctx, data))
      case CMD.weight:
        return defer('weight', 5, () => weight(ctx, data))
      case CMD.today:
        return defer('today', 5, () => todayView(ctx))
      case CMD.coach:
        return defer('coach', 5, () => coach(ctx, data))
    }
  }
  if (interaction.type === 3) {
    const id = str(data.custom_id)
    // 버튼은 '원래 메시지를 곧 고치겠다'(6)로 답하고, 같은 방법으로 그 메시지를 고친다.
    if (id.startsWith(UNDO_PREFIX)) return defer('undo', 6, () => undo(ctx, id.slice(UNDO_PREFIX.length)))
  }
  return ephemeral(MSG.unknown)
}
