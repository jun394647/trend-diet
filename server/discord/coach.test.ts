// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { EFFORT, NudgeSchema, buildParams, tidyResult, type CallModel } from '../ai/model.ts'
import { buildPrompt, type NudgeRequest } from '../ai/prompts.ts'
import type { Env } from '../data/records.ts'
import { handleCoachCron, slotOf, type CoachDeps } from './coach.ts'
import { BOT_TOKEN, CRON_SECRET, NOW, OWNER, SECRETS, USER_ID, env, loggedText, modelOk, seedRows, weightEntry, world, type Row, type WorldOptions } from './testkit.ts'

let log: MockInstance<typeof console.log>
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

const ENV = env({ DISCORD_PUBLIC_KEY: 'ab'.repeat(32) })
const AI_TEXT = '목요일 아침이에요. 어제는 범위 안이었어요.'

interface Setup extends WorldOptions {
  env?: Env
  callModel?: CallModel
  now?: Date
  auth?: string | null
}

async function run(slot: string | null, o: Setup = {}) {
  const w = world(o)
  const callModel = vi.fn<CallModel>(o.callModel ?? modelOk({ message: AI_TEXT }))
  const deps: CoachDeps = { env: o.env ?? ENV, fetch: w.fetch, callModel, now: () => o.now ?? NOW }
  const auth = o.auth === undefined ? `Bearer ${CRON_SECRET}` : o.auth
  const url = `https://app.test/api/cron/coach${slot === null ? '' : `?slot=${slot}`}`
  const res = await handleCoachCron(new Request(url, { headers: auth ? { Authorization: auth } : {} }), deps)
  return { w, callModel, res, body: (await res.json()) as Record<string, unknown> }
}

const without = (...keys: string[]): Row[] => seedRows().filter((r) => !keys.includes(r.key))

describe('GET /api/cron/coach: 누가 부를 수 있나', () => {
  it.each([null, 'Bearer nope', CRON_SECRET])('비밀값이 맞지 않으면(%s) 401이고 아무것도 하지 않는다', async (auth) => {
    const { w, res, callModel } = await run('morning', { auth })
    expect(res.status).toBe(401)
    expect(w.sent).toHaveLength(0)
    expect(callModel).not.toHaveBeenCalled()
  })

  it('CRON_SECRET이 없으면 401', async () => {
    const { res } = await run('morning', { env: { ...ENV, CRON_SECRET: undefined }, auth: 'Bearer undefined' })
    expect(res.status).toBe(401)
  })

  it('모르는 slot은 400', async () => {
    const { res, w } = await run('noon')
    expect(res.status).toBe(400)
    expect(w.sent).toHaveLength(0)
  })

  it('slot이 없으면 한국 시각으로 가늠한다', () => {
    const req = new Request('https://app.test/api/cron/coach')
    expect(slotOf(req, new Date('2026-11-18T23:40:00Z'))).toBe('morning')
    expect(slotOf(req, new Date('2026-11-19T12:59:00Z'))).toBe('evening')
    expect(slotOf(new Request('https://app.test/api/cron/coach?slot=evening'), new Date('2026-11-18T23:40:00Z'))).toBe('evening')
  })
})

describe('보내지 않는 경우', () => {
  it.each(['DISCORD_BOT_TOKEN', 'DISCORD_OWNER_ID', 'DISCORD_APPLICATION_ID', 'DISCORD_PUBLIC_KEY'])('%s가 없으면 503과 이유를 돌려준다', async (name) => {
    const { res, body, w } = await run('morning', { env: { ...ENV, [name]: '' } })
    expect(res.status).toBe(503)
    expect(body).toEqual({ slot: 'morning', ok: false, sent: false, skipped: 'discord_not_configured' })
    expect(w.sent).toHaveLength(0)
  })

  it.each(['SUPABASE_SERVICE_ROLE_KEY', 'APP_OWNER_USER_ID'])('%s가 없으면 503과 이유를 돌려준다', async (name) => {
    const { res, body } = await run('evening', { env: { ...ENV, [name]: '' } })
    expect(res.status).toBe(503)
    expect(body).toEqual({ slot: 'evening', ok: false, sent: false, skipped: 'data_not_configured' })
  })

  it.each([
    ['프로필이 없음', without('profile')],
    ['체크인(계획)이 없음', without('2026-11-16')],
    ['아무 기록도 없음', []],
  ])('처음 설정 전(%s)이면 보내지 않고 횟수도 쓰지 않는다', async (_name, rows) => {
    const { res, body, w, callModel } = await run('morning', { rows })
    expect(res.status).toBe(200)
    expect(body).toEqual({ slot: 'morning', ok: true, sent: false, skipped: 'not_onboarded' })
    expect(w.takeCalls()).toHaveLength(0)
    expect(w.dms()).toHaveLength(0)
    expect(callModel).not.toHaveBeenCalled()
  })

  it('기록을 읽지 못하면 500이고 보내지 않는다', async () => {
    const { res, body, w } = await run('morning', { failOn: 'load' })
    expect(res.status).toBe(500)
    expect(body).toMatchObject({ ok: false, sent: false, error: 'data_failed', status: 500 })
    expect(w.dms()).toHaveLength(0)
  })

  it('디스코드가 메시지를 받지 않으면 502와 디스코드의 오류를 돌려준다', async () => {
    const { res, body } = await run('morning', { discordFail: 'dm-message' })
    expect(res.status).toBe(502)
    expect(body).toMatchObject({ ok: false, sent: false, error: 'discord_failed', status: 403, discord: { code: 50007 } })
  })
})

describe('아침', () => {
  it('횟수를 하나 쓰고, 숫자를 미리 셈해 넘기고, 모델이 쓴 글을 주인에게 개인 메시지로 보낸다', async () => {
    const { res, body, w, callModel } = await run('morning')
    expect(res.status).toBe(200)
    expect(body).toEqual({ slot: 'morning', ok: true, sent: true, source: 'ai', date: '2026-11-19', length: AI_TEXT.length })
    expect(w.takeCalls()).toHaveLength(1)
    expect(w.takeCalls()[0].body).toEqual({ p_user: USER_ID, p_limit: 40 })

    const arg = callModel.mock.calls[0][0]
    expect(arg.userId).toBe(USER_ID)
    expect(arg.request).toMatchObject({
      task: 'nudge',
      slot: 'morning',
      context: { today: '2026-11-19', phase: 'lose', targetLow: 1900, targetHigh: 2100 },
      facts: {
        date: '2026-11-19',
        weekday: '목요일',
        rangeName: '목표 범위',
        yesterday: { date: '2026-11-18', kcal: 1950, state: 'in' },
        today: { kcal: 600, mealCount: 1, state: 'under' },
        week: { loggedDays: 4, avgDays: 3, avgKcal: 2083, avgState: 'in', todayExcluded: true },
        lastWeek: null,
        checkinDue: false,
      },
    })

    const dm = w.sent.filter((s) => s.url.startsWith('https://discord.com'))
    expect(dm.map((s) => `${s.method} ${s.url.replace('https://discord.com/api/v10', '')}`)).toEqual(['POST /users/@me/channels', 'POST /channels/dm-1/messages'])
    expect(dm[0].body).toEqual({ recipient_id: OWNER })
    expect(dm[0].headers.authorization).toBe(`Bot ${BOT_TOKEN}`)
    expect(w.dms()).toEqual([{ content: AI_TEXT, components: [], allowed_mentions: { parse: [] } }])
  })

  it('월요일 아침에는 막 끝난 지난주의 평균과 추세 변화를, 체크인할 때가 됐으면 그것도 넘긴다', async () => {
    const rows: Row[] = [...seedRows(), { user_id: USER_ID, kind: 'weight', key: '2026-11-09', data: weightEntry('2026-11-09', 80), deleted: false }]
    // 한국 시각 11월 23일(월) 08:10
    const { callModel } = await run('morning', { rows, now: new Date('2026-11-22T23:10:00Z') })
    expect(callModel.mock.calls[0][0].request).toMatchObject({
      facts: {
        date: '2026-11-23',
        weekday: '월요일',
        yesterday: { date: '2026-11-22', kcal: null, state: 'none' },
        today: { kcal: 0, mealCount: 0 },
        week: { loggedDays: 0, avgKcal: null, avgState: 'none' },
        lastWeek: { loggedDays: 4, avgKcal: 1713, avgState: 'under', trendChangeKg: -0.32 },
        checkinDue: true,
      },
    })
  })

  it('모델이 실패하면 숫자로 만든 글을 대신 보낸다', async () => {
    const { res, body, w } = await run('morning', { callModel: async () => ({ ok: false, error: 'busy' }) })
    expect(res.status).toBe(200)
    expect(body).toMatchObject({ ok: true, sent: true, source: 'fallback', reason: 'busy' })
    expect(w.dms()[0].content).toBe(
      [
        '11월 19일 (목) 아침이에요.',
        '어제는 1,950 kcal로 목표 범위 안이었어요.',
        '이번 주는 오늘을 뺀 3일 평균 2,083 kcal로 목표 범위 안이에요.',
        '오늘 목표 범위는 1,900~2,100 kcal예요.',
      ].join('\n'),
    )
  })

  it('월요일의 대신 보내는 글에는 지난주와 체크인이 들어간다', async () => {
    const rows: Row[] = [...seedRows(), { user_id: USER_ID, kind: 'weight', key: '2026-11-09', data: weightEntry('2026-11-09', 80), deleted: false }]
    const { w } = await run('morning', { rows, now: new Date('2026-11-22T23:10:00Z'), callModel: async () => ({ ok: false, error: 'failed' }) })
    expect(w.dms()[0].content).toBe(
      [
        '11월 23일 (월) 아침이에요.',
        '어제는 식사 기록이 없어요.',
        '지난주는 기록한 4일 평균 1,713 kcal로 목표 범위보다 적었어요.',
        '추세 체중은 한 주 동안 0.3 kg 내려갔어요.',
        '오늘 목표 범위는 1,900~2,100 kcal예요.',
        '앱에서 주간 체크인을 할 때가 됐어요.',
      ].join('\n'),
    )
  })

  it('어제 범위를 넘었어도 덜 먹으라고 하지 않는다', async () => {
    const { w } = await run('morning', { now: new Date('2026-11-17T23:10:00Z'), callModel: async () => ({ ok: false, error: 'failed' }) })
    const text = w.dms()[0].content
    expect(text).toContain('어제는 2,300 kcal로 목표 범위를 200 kcal 넘었어요. 한 주 평균으로 보면 돼요.')
    expect(text).not.toMatch(/줄이|덜 먹|참|노력|의지/)
  })
})

describe('저녁', () => {
  it('오늘 기록이 없으면 그 사실을 넘기고, 대신 보내는 글은 가볍게 권한다', async () => {
    const rows = without('m-today')
    const ok = await run('evening', { rows })
    expect(ok.callModel.mock.calls[0][0].request).toMatchObject({ task: 'nudge', slot: 'evening', facts: { today: { kcal: 0, mealCount: 0 } } })
    expect(ok.w.dms()[0].content).toBe(AI_TEXT)

    const fb = await run('evening', { rows, callModel: async () => ({ ok: false, error: 'refused' }) })
    expect(fb.body).toMatchObject({ sent: true, source: 'fallback', reason: 'refused' })
    expect(fb.w.dms()[0].content).toBe('오늘 먹은 것을 대충이라도 적어 둘까요. /먹었어 로 한 줄만 보내면 돼요. 내일 적어도 괜찮아요.')
  })

  it('기록이 있으면 대신 보내는 글은 오늘과 이번 주 평균만 말한다', async () => {
    const { w } = await run('evening', {
      callModel: async () => {
        throw new Error('boom')
      },
    })
    expect(w.dms()[0].content).toBe(
      ['오늘은 지금까지 600 kcal예요. 1,300~1,500 kcal 더 먹으면 목표 범위 안이에요.', '이번 주는 오늘을 뺀 3일 평균 2,083 kcal로 목표 범위 안이에요.'].join('\n'),
    )
  })

  it('유지 기간이면 유지 범위로 말한다', async () => {
    const rows = seedRows().map((r) => (r.kind === 'profile' ? { ...r, data: { ...(r.data as object), phase: 'maintain', breakUntil: '2026-11-30' } } : r))
    const { w, callModel } = await run('evening', { rows, callModel: async () => ({ ok: false, error: 'failed' }) })
    expect(callModel.mock.calls[0][0].request).toMatchObject({ context: { phase: 'maintain', breakUntil: '2026-11-30' }, facts: { rangeName: '유지 범위' } })
    expect(w.dms()[0].content).toContain('유지 범위 안이에요.')
    expect(w.dms()[0].content).not.toContain('목표 범위')
  })
})

describe('대신 보내는 글로 넘어가는 이유', () => {
  it('한도를 넘었으면 Claude를 부르지 않고 대신 보낸다', async () => {
    const { body, w, callModel } = await run('morning', { take: -1 })
    expect(body).toMatchObject({ ok: true, sent: true, source: 'fallback', reason: 'limit' })
    expect(callModel).not.toHaveBeenCalled()
    expect(w.dms()).toHaveLength(1)
  })

  it('횟수를 확인하지 못해도 Claude를 부르지 않고 대신 보낸다', async () => {
    const { body, callModel } = await run('morning', { failOn: 'usage' })
    expect(body).toMatchObject({ sent: true, source: 'fallback', reason: 'usage_failed' })
    expect(callModel).not.toHaveBeenCalled()
  })

  it('AI 키가 없으면 횟수를 쓰지 않고 대신 보낸다', async () => {
    const { body, w } = await run('evening', { env: { ...ENV, ANTHROPIC_API_KEY: '' } })
    expect(body).toMatchObject({ sent: true, source: 'fallback', reason: 'ai_not_configured' })
    expect(w.takeCalls()).toHaveLength(0)
  })

  it('모델이 빈 글이나 엉뚱한 모양을 주면 대신 보낸다', async () => {
    for (const result of [{ message: '   ' }, { answer: '모양이 달라요' }]) {
      const { body } = await run('morning', { callModel: modelOk(result) })
      expect(body).toMatchObject({ sent: true, source: 'fallback', reason: 'failed' })
    }
  })

  it('너무 긴 글은 디스코드 제한에 맞춰 자른다', async () => {
    const { w } = await run('morning', { callModel: modelOk({ message: '오늘도 평소처럼 지내면 돼요. '.repeat(200) }) })
    expect(w.dms()[0].content.length).toBeLessThanOrEqual(2000)
    expect(w.dms()[0].content.endsWith('돼요.')).toBe(true)
  })
})

describe('로그', () => {
  it('결과만 남기고 보낸 글과 비밀값은 남기지 않는다', async () => {
    await run('morning')
    await run('evening', { callModel: async () => ({ ok: false, error: 'busy' }) })
    const lines = log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ evt: 'coach', slot: 'morning', ok: true, sent: true, source: 'ai' })
    expect(lines[1]).toMatchObject({ evt: 'coach', slot: 'evening', ok: true, sent: true, source: 'fallback', reason: 'busy' })
    const out = loggedText(log)
    for (const s of [...SECRETS, AI_TEXT, '범위', '2,083']) expect(out).not.toContain(s)
  })
})

describe("서버 전용 task 'nudge'", () => {
  const request = async (slot: 'morning' | 'evening'): Promise<NudgeRequest> => {
    const { callModel } = await run(slot)
    return callModel.mock.calls[0][0].request as NudgeRequest
  }

  it('effort는 low이고, 구조화 출력으로 { message }를 받는다', async () => {
    expect(EFFORT.nudge).toBe('low')
    const p = buildParams(await request('morning')) as unknown as { model: string; output_config: { effort: string; format: { type: string } } }
    expect(p.model).toBe('claude-haiku-5-5')
    expect(p.output_config.effort).toBe('low')
    expect(p.output_config.format.type).toBe('json_schema')
    expect(NudgeSchema.safeParse({ message: '안녕하세요.' }).success).toBe(true)
    expect(tidyResult('nudge', { message: '  안녕하세요.  ' })).toEqual({ message: '안녕하세요.' })
    expect(tidyResult('nudge', { message: ' ' })).toBeNull()
    expect(tidyResult('nudge', { answer: 'x' })).toBeNull()
  })

  it('시스템 프롬프트는 고정이고, 날짜·요일·숫자·slot은 user 턴에 들어간다', async () => {
    const morning = buildPrompt(await request('morning'))
    const evening = buildPrompt(await request('evening'))
    expect(morning.system).toBe(evening.system)
    for (const phrase of ['해요체', '이모지와 느낌표는 쓰지 않습니다', '/먹었어', '350자', '유지 휴식', '메우라고 하지 않고', '날마다 다르게']) {
      expect(morning.system).toContain(phrase)
    }
    expect(morning.system).not.toContain('2026-11-19')
    const user = String(morning.messages[0].content)
    expect(morning.messages).toHaveLength(1)
    expect(user).toContain('"weekday":"목요일"')
    expect(user).toContain('"date":"2026-11-19"')
    expect(user).toContain('"avgKcal":2083')
    expect(user).toContain('slot: morning')
    expect(String(evening.messages[0].content)).toContain('slot: evening')
    expect(user).not.toMatch(/undefined|NaN/)
  })
})
