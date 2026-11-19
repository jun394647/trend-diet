/**
 * GET /api/cron/coach?slot=morning|evening : 코치가 먼저 건네는 아침·저녁 한마디.
 * Vercel Cron이 Authorization: Bearer <CRON_SECRET>으로 부른다.
 * 숫자는 앱과 같은 규칙으로 서버가 셈하고, 글은 Claude가 쓴다. Claude를 쓸 수 없으면 숫자로 만든 짧은 글을 대신 보낸다.
 */
import { buildCoachContext } from '../../src/ai/context.ts'
import { addDays, formatKorean, parseDate } from '../../src/lib/date.ts'
import type { Plan } from '../../src/lib/plan.ts'
import { isCheckinDue, kcalOn, mealsOn } from '../../src/lib/selectors.ts'
import { intakeState, targetRange, weekSummary } from '../../src/lib/sustain.ts'
import { computeTrend, trendAt } from '../../src/lib/trend.ts'
import type { Profile } from '../../src/types.ts'
import { dailyLimit } from '../ai/handler.ts'
import { NudgeSchema, type CallModel } from '../ai/model.ts'
import type { NudgeFacts } from '../ai/prompts.ts'
import { DataError, dataConfig, kstToday, loadUserData, takeAiUse, type Env, type UserData } from '../data/records.ts'
import { sendDm } from './api.ts'
import { discordConfig, hasCronSecret, json } from './setup.ts'
import { dayStatus, fitMessage, fmtKcal, fmtKg, onboarded, rangeNameOf, todayLine, weekLine } from './text.ts'

export type Slot = 'morning' | 'evening'

export interface CoachDeps {
  env: Env
  fetch: typeof fetch
  callModel: CallModel
  now: () => Date
}

const value = (s: string | undefined): string => (s ?? '').trim()
const WEEKDAYS = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']

/** slot이 없으면 한국 시각으로 가늠한다: 오후 3시 전이면 아침, 그 뒤면 저녁. */
export function slotOf(request: Request, now: Date): Slot | null {
  const raw = new URL(request.url).searchParams.get('slot')
  if (raw === 'morning' || raw === 'evening') return raw
  if (raw !== null && raw !== '') return null
  return (now.getUTCHours() + 9) % 24 < 15 ? 'morning' : 'evening'
}

export function buildFacts(data: UserData, profile: Profile, plan: Plan, today: string, slot: Slot): NudgeFacts {
  const status = dayStatus(data, profile, plan, today)
  const yesterday = addDays(today, -1)
  const yMeals = mealsOn(data.meals, yesterday)
  const yKcal = yMeals.length > 0 ? kcalOn(data.meals, yesterday) : null
  const dow = parseDate(today).getDay()

  let lastWeek: NudgeFacts['lastWeek'] = null
  if (slot === 'morning' && dow === 1) {
    // 월요일 아침: 어제(일요일)로 끝난 한 주.
    const w = weekSummary({ meals: data.meals, weights: data.weights, targetKcal: plan.targetKcal, asOf: yesterday })
    const trend = computeTrend(data.weights)
    const end = trendAt(trend, yesterday)
    const start = trendAt(trend, addDays(yesterday, -7))
    lastWeek = {
      loggedDays: w.mealDays,
      avgKcal: w.avgKcal,
      avgState: w.avgState,
      trendChangeKg: end === null || start === null ? null : Math.round((end - start) * 100) / 100,
    }
  }
  return {
    date: today,
    weekday: WEEKDAYS[dow],
    rangeName: status.rangeName,
    yesterday: { date: yesterday, kcal: yKcal, state: yKcal === null ? 'none' : intakeState(yKcal, plan.targetKcal) },
    today: { kcal: status.eaten, mealCount: mealsOn(data.meals, today).length, state: status.state },
    week: {
      loggedDays: status.week.mealDays,
      avgDays: status.week.avgDays,
      avgKcal: status.week.avgKcal,
      avgState: status.week.avgState,
      todayExcluded: status.week.avgDays < status.week.mealDays,
    },
    lastWeek,
    checkinDue: isCheckinDue(data.checkins, today),
  }
}

/** Claude 없이 숫자만으로 만드는 글. 모델을 부르지 못했을 때 아무것도 안 보내는 대신 이것을 보낸다. */
export function fallbackMessage(data: UserData, profile: Profile, plan: Plan, today: string, slot: Slot): string {
  const facts = buildFacts(data, profile, plan, today, slot)
  const status = dayStatus(data, profile, plan, today)
  const range = targetRange(plan.targetKcal)
  const name = rangeNameOf(profile)
  const out: string[] = []

  if (slot === 'evening') {
    if (facts.today.mealCount === 0) {
      return '오늘 먹은 것을 대충이라도 적어 둘까요. /먹었어 로 한 줄만 보내면 돼요. 내일 적어도 괜찮아요.'
    }
    out.push(`오늘은 지금까지 ${fmtKcal(status.eaten)} kcal예요. ${todayLine(status)}`)
    if (status.week.avgKcal !== null) out.push(`이번 주는 ${weekLine(status.week, name)}`)
    return out.join('\n')
  }

  out.push(`${formatKorean(today)} 아침이에요.`)
  const y = facts.yesterday
  if (y.kcal === null) out.push('어제는 식사 기록이 없어요.')
  else if (y.state === 'in') out.push(`어제는 ${fmtKcal(y.kcal)} kcal로 ${name} 안이었어요.`)
  else if (y.state === 'over') out.push(`어제는 ${fmtKcal(y.kcal)} kcal로 ${name}를 ${fmtKcal(y.kcal - range.high)} kcal 넘었어요. 한 주 평균으로 보면 돼요.`)
  else out.push(`어제는 ${fmtKcal(y.kcal)} kcal로 ${name}보다 ${fmtKcal(range.low - y.kcal)} kcal 적었어요.`)

  const lw = facts.lastWeek
  if (lw) {
    if (lw.avgKcal === null) out.push('지난주에는 식사 기록이 없었어요.')
    else {
      const how = lw.avgState === 'in' ? `${name} 안이었어요` : lw.avgState === 'over' ? `${name}보다 조금 많았어요` : `${name}보다 적었어요`
      out.push(`지난주는 기록한 ${lw.loggedDays}일 평균 ${fmtKcal(lw.avgKcal)} kcal로 ${how}.`)
    }
    if (lw.trendChangeKg !== null) {
      const d = Math.round(lw.trendChangeKg * 10) / 10
      out.push(d === 0 ? '추세 체중은 한 주 동안 거의 그대로였어요.' : `추세 체중은 한 주 동안 ${fmtKg(Math.abs(d))} kg ${d < 0 ? '내려갔어요' : '올라갔어요'}.`)
    }
  } else if (status.week.avgKcal !== null) {
    out.push(`이번 주는 ${weekLine(status.week, name)}`)
  }
  out.push(`오늘 ${name}는 ${fmtKcal(range.low)}~${fmtKcal(range.high)} kcal예요.`)
  if (facts.checkinDue) out.push('앱에서 주간 체크인을 할 때가 됐어요.')
  return out.join('\n')
}

export async function handleCoachCron(request: Request, deps: CoachDeps): Promise<Response> {
  const { env } = deps
  if (!hasCronSecret(request, env)) return json({ ok: false, error: 'unauthorized' }, 401)
  const now = deps.now()
  const slot = slotOf(request, now)
  if (!slot) return json({ ok: false, error: 'bad_request' }, 400)

  const started = Date.now()
  const finish = (body: Record<string, unknown>, status: number): Response => {
    const { ok, sent, source, reason, skipped, error } = body
    console.log(JSON.stringify({ evt: 'coach', slot, ms: Date.now() - started, ok, sent, source, reason, skipped, error }))
    return json({ slot, ...body }, status)
  }

  const discord = discordConfig(env)
  if (!discord) return finish({ ok: false, sent: false, skipped: 'discord_not_configured' }, 503)
  const cfg = dataConfig(env)
  if (!cfg) return finish({ ok: false, sent: false, skipped: 'data_not_configured' }, 503)

  const today = kstToday(now)
  let data: UserData
  try {
    data = await loadUserData(deps.fetch, cfg)
  } catch (e) {
    return finish({ ok: false, sent: false, error: 'data_failed', status: e instanceof DataError ? e.status : 'unexpected' }, 500)
  }
  const ready = onboarded(data)
  const context = ready ? buildCoachContext({ ...data, profile: ready.profile, asOf: today }) : null
  if (!ready || !context) return finish({ ok: true, sent: false, skipped: 'not_onboarded' }, 200)

  // 글은 Claude가 쓴다. 쓸 수 없는 이유가 하나라도 있으면 숫자로 만든 글로 대신한다.
  let message: string | null = null
  let reason: string | undefined
  if (!value(env.ANTHROPIC_API_KEY)) reason = 'ai_not_configured'
  else {
    const count = await takeAiUse(deps.fetch, cfg, dailyLimit(env))
    if (count === null) reason = 'usage_failed'
    else if (count === -1) reason = 'limit'
    else {
      try {
        const facts = buildFacts(data, ready.profile, ready.plan, today, slot)
        const outcome = await deps.callModel({ request: { task: 'nudge', slot, context, facts }, userId: cfg.userId })
        if (!outcome.ok) reason = outcome.error
        else {
          const parsed = NudgeSchema.safeParse(outcome.result)
          if (parsed.success && parsed.data.message.trim()) message = parsed.data.message
          else reason = 'failed'
        }
      } catch {
        reason = 'failed'
      }
    }
  }
  const source = message === null ? 'fallback' : 'ai'
  const content = fitMessage(message ?? fallbackMessage(data, ready.profile, ready.plan, today, slot))

  const dm = await sendDm(deps.fetch, discord.botToken, discord.ownerId, content)
  if (!dm.ok) return finish({ ok: false, sent: false, source, reason, error: 'discord_failed', status: dm.status, discord: dm.body }, 502)
  return finish({ ok: true, sent: true, source, reason, date: today, length: content.length }, 200)
}
