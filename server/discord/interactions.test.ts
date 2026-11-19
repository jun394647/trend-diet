// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import type { MealEntry, WeightEntry } from '../../src/types.ts'
import { sampleResults } from '../ai/fixtures.ts'
import type { CallModel } from '../ai/model.ts'
import type { Env } from '../data/records.ts'
import { CMD, OPT, UNDO_PREFIX } from './commands.ts'
import { handleInteraction, MAX_PHOTO_BYTES, type DiscordDeps } from './interactions.ts'
import {
  APP_ID,
  INTERACTION_TOKEN,
  NOW,
  OWNER,
  SECRETS,
  TODAY,
  USER_ID,
  env,
  keypair,
  loggedText,
  modelOk,
  seedRows,
  waiter,
  world,
  type Row,
  type WorldOptions,
} from './testkit.ts'
import { MSG } from './text.ts'

let keys: Awaited<ReturnType<typeof keypair>>
let log: MockInstance<typeof console.log>

beforeAll(async () => {
  keys = await keypair()
})
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

interface Setup extends WorldOptions {
  env?: Env
  callModel?: CallModel
}

function setup(o: Setup = {}) {
  const w = world(o)
  const wait = waiter()
  const callModel = vi.fn<CallModel>(o.callModel ?? modelOk(sampleResults['meal-text']))
  const deps: DiscordDeps = {
    env: o.env ?? env({ DISCORD_PUBLIC_KEY: keys.publicKey }),
    fetch: w.fetch,
    callModel,
    now: () => NOW,
    waitUntil: wait.waitUntil,
  }
  return { w, wait, callModel, deps }
}

async function signed(body: unknown, o: { timestamp?: string; signature?: string; tamper?: string; headers?: boolean } = {}): Promise<Request> {
  const raw = typeof body === 'string' ? body : JSON.stringify(body)
  const timestamp = o.timestamp ?? '1763521200'
  const signature = o.signature ?? (await keys.sign(timestamp, raw))
  return new Request('https://app.test/api/discord', {
    method: 'POST',
    headers: o.headers === false ? {} : { 'x-signature-ed25519': signature, 'x-signature-timestamp': timestamp, 'Content-Type': 'application/json' },
    body: o.tamper ?? raw,
  })
}

const base = { application_id: APP_ID, token: INTERACTION_TOKEN, user: { id: OWNER } }
const command = (name: string, options: unknown[] = [], extra: Record<string, unknown> = {}) => ({
  ...base,
  type: 2,
  data: { name, options, ...extra },
})
const ateCmd = (text: string) => command(CMD.ate, [{ name: OPT.text, type: 3, value: text }])
const button = (customId: string) => ({ ...base, type: 3, data: { custom_id: customId, component_type: 2 } })

/** 명령을 보내고, 미뤄 둔 일이 끝난 뒤 원래 응답에 마지막으로 쓴 내용을 돌려준다. */
async function run(s: ReturnType<typeof setup>, interaction: unknown) {
  const res = await handleInteraction(await signed(interaction), s.deps)
  const first = (await res.json()) as { type: number; data?: { content: string; flags: number } }
  await s.wait.settle()
  const edits = s.w.edits()
  return { res, first, edits, last: edits[edits.length - 1] }
}

describe('서명 확인', () => {
  it('맞는 서명의 PING에는 type 1로 답한다', async () => {
    const s = setup()
    const res = await handleInteraction(await signed({ type: 1 }), s.deps)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ type: 1 })
    expect(s.w.sent).toHaveLength(0)
  })

  it('본문이 바뀌었으면 401', async () => {
    const s = setup()
    const res = await handleInteraction(await signed({ type: 1 }, { tamper: '{"type":1 }' }), s.deps)
    expect(res.status).toBe(401)
  })

  it('다른 열쇠로 한 서명이면 401', async () => {
    const s = setup()
    const other = await keypair()
    const raw = JSON.stringify({ type: 1 })
    const res = await handleInteraction(await signed(raw, { signature: await other.sign('1763521200', raw) }), s.deps)
    expect(res.status).toBe(401)
  })

  it('시각이 다르면 401', async () => {
    const s = setup()
    const raw = JSON.stringify({ type: 1 })
    const res = await handleInteraction(await signed(raw, { signature: await keys.sign('1', raw), timestamp: '2' }), s.deps)
    expect(res.status).toBe(401)
  })

  it('서명 헤더가 없거나 형식이 틀리면 401이고 아무 일도 하지 않는다', async () => {
    const s = setup()
    expect((await handleInteraction(await signed(ateCmd('밥'), { headers: false }), s.deps)).status).toBe(401)
    expect((await handleInteraction(await signed(ateCmd('밥'), { signature: 'zz' }), s.deps)).status).toBe(401)
    expect((await handleInteraction(await signed(ateCmd('밥'), { signature: '' }), s.deps)).status).toBe(401)
    expect(s.w.sent).toHaveLength(0)
    expect(s.wait.pending).toHaveLength(0)
  })

  it('공개 키가 설정되지 않았으면 503 JSON', async () => {
    const s = setup({ env: env() })
    const res = await handleInteraction(await signed({ type: 1 }), s.deps)
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ ok: false, error: 'not_configured' })
  })

  it('주인 ID가 설정되지 않았으면 503 JSON', async () => {
    const s = setup({ env: env({ DISCORD_PUBLIC_KEY: keys.publicKey, DISCORD_OWNER_ID: '' }) })
    expect((await handleInteraction(await signed(ateCmd('밥')), s.deps)).status).toBe(503)
  })
})

describe('주인만 쓸 수 있다', () => {
  it.each([
    ['DM', { user: { id: '222' } }],
    ['서버', { member: { user: { id: '222' } }, user: undefined }],
  ])('%s에서 다른 사람이 부르면 본인에게만 보이는 거절로 답하고 아무 일도 하지 않는다', async (_where, who) => {
    const s = setup()
    const res = await handleInteraction(await signed({ ...ateCmd('밥'), ...who }), s.deps)
    expect(await res.json()).toEqual({ type: 4, data: { content: '이 봇은 주인만 쓸 수 있어요.', flags: 64, allowed_mentions: { parse: [] } } })
    expect(s.wait.pending).toHaveLength(0)
    expect(s.w.sent).toHaveLength(0)
    expect(s.callModel).not.toHaveBeenCalled()
  })

  it('서버에서 주인이 부르면(member.user.id) 받아들인다', async () => {
    const s = setup()
    const { first } = await run(s, { ...command(CMD.today), user: undefined, member: { user: { id: OWNER } } })
    expect(first.type).toBe(5)
  })

  it('다른 사람은 취소 버튼도 누를 수 없다', async () => {
    const s = setup()
    const res = await handleInteraction(await signed({ ...button(`${UNDO_PREFIX}abcdef0123456789`), user: { id: '222' } }), s.deps)
    expect(((await res.json()) as { data: { content: string } }).data.content).toBe(MSG.notOwner)
    expect(s.w.sent).toHaveLength(0)
  })

  it('기록을 읽을 설정이 없으면 본인에게만 보이는 안내로 답한다', async () => {
    const s = setup({ env: env({ DISCORD_PUBLIC_KEY: keys.publicKey, APP_OWNER_USER_ID: '' }) })
    const res = await handleInteraction(await signed(command(CMD.today)), s.deps)
    expect(((await res.json()) as { data: { content: string } }).data.content).toBe(MSG.notConfigured)
  })

  it('모르는 명령에는 안내로 답한다', async () => {
    const s = setup()
    const res = await handleInteraction(await signed(command('없는명령')), s.deps)
    expect(((await res.json()) as { data: { content: string } }).data.content).toBe(MSG.unknown)
  })
})

describe('미뤄 둔 응답', () => {
  it('먼저 type 5로 답하고, 원래 응답은 waitUntil에 맡긴 일 안에서 고친다', async () => {
    let release = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const s = setup({
      callModel: async () => {
        await gate
        return { ok: true, result: sampleResults['meal-text'] }
      },
    })
    const res = await handleInteraction(await signed(ateCmd('김치찌개랑 밥')), s.deps)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('application/json')
    expect(await res.json()).toEqual({ type: 5 })
    // 응답은 이미 나갔고, 모델은 아직 답하지 않았다.
    expect(s.wait.pending).toHaveLength(1)
    expect(s.w.edits()).toHaveLength(0)
    expect(s.w.upserts()).toHaveLength(0)
    release()
    await s.wait.settle()
    expect(s.w.edits()).toHaveLength(1)
    const edit = s.w.sent.find((x) => x.url.includes('/messages/@original'))
    expect(edit?.url).toBe(`https://discord.com/api/v10/webhooks/${APP_ID}/${INTERACTION_TOKEN}/messages/@original`)
    expect(edit?.method).toBe('PATCH')
    expect(edit?.headers.authorization).toBeUndefined()
  })
})

describe(`/${CMD.ate}`, () => {
  it('음식마다 오늘 날짜의 식사 한 건씩을 쓰고, 항목·합계·오늘 상태와 취소 버튼을 보여 준다', async () => {
    const s = setup()
    const { first, last } = await run(s, ateCmd('점심에 김치찌개랑 밥 한 공기'))
    expect(first).toEqual({ type: 5 })

    expect(s.w.takeCalls()).toHaveLength(1)
    expect(s.w.takeCalls()[0].body).toEqual({ p_user: USER_ID, p_limit: 40 })
    expect(s.callModel).toHaveBeenCalledWith({ request: { task: 'meal-text', text: '점심에 김치찌개랑 밥 한 공기' }, userId: USER_ID })

    const written = s.w.upserts()
    expect(written).toHaveLength(2)
    const batch = (written[0].data as { batch: string }).batch
    expect(batch).toMatch(/^[0-9a-f]{16}$/)
    written.forEach((r, i) => {
      const m = r.data as MealEntry & { batch: string }
      expect(r).toMatchObject({ user_id: USER_ID, kind: 'meal', key: m.id, deleted: false })
      expect(m.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
      // 앱의 MealEntry 모양 그대로(묶음 키만 더해서) 들어간다.
      expect(Object.keys(m).sort()).toEqual(['batch', 'createdAt', 'date', 'id', 'kcal', 'name', 'source'])
      expect(m).toMatchObject({ date: TODAY, source: 'ai', batch, name: ['김치찌개', '밥'][i], kcal: [250, 310][i] })
      expect(new Date(m.createdAt).toISOString()).toBe(m.createdAt)
    })
    expect((written[0].data as MealEntry).createdAt < (written[1].data as MealEntry).createdAt).toBe(true)

    expect(last.content).toBe(
      [
        '기록했어요.',
        '김치찌개 · 1인분 · 250 kcal',
        '밥 · 1공기\\(210g\\) · 310 kcal',
        '합계 560 kcal',
        '양이 적히지 않은 것은 1인분으로 봤어요.',
        '',
        '오늘 1,160 kcal · 목표 범위 1,900~2,100',
        '740~940 kcal 더 먹으면 목표 범위 안이에요.',
      ].join('\n'),
    )
    expect(last.allowed_mentions).toEqual({ parse: [] })
    const customId = `${UNDO_PREFIX}${batch}`
    expect(customId.length).toBeLessThanOrEqual(100)
    expect(last.components).toEqual([{ type: 1, components: [{ type: 2, style: 2, label: '방금 기록 취소', custom_id: customId }] }])
  })

  it('범위 안이 되면 그렇게 말한다', async () => {
    const s = setup({ callModel: modelOk({ items: [{ name: '정식', amount: '1인분', kcal: 1400, confidence: 'medium' }], note: '' }) })
    const { last } = await run(s, ateCmd('정식'))
    expect(last.content).toContain('오늘 2,000 kcal · 목표 범위 1,900~2,100\n목표 범위 안이에요.')
  })

  it('범위를 넘으면 얼마나 넘었는지와 한 주 평균으로 보자는 말을 한다', async () => {
    const s = setup({ callModel: modelOk({ items: [{ name: '뷔페', amount: '1인분', kcal: 2000, confidence: 'low' }], note: '넉넉하게 봤어요.' }) })
    const { last } = await run(s, ateCmd('뷔페'))
    expect(last.content).toContain('오늘 2,600 kcal · 목표 범위 1,900~2,100\n목표 범위를 500 kcal 넘었어요. 하루쯤은 괜찮아요. 한 주 평균으로 봐요.')
  })

  it('넘었어도 이번 주 평균이 범위 안이면 괜찮다고 말한다', async () => {
    const rows = seedRows().filter((r) => r.key !== 'm-tue')
    const s = setup({ rows, callModel: modelOk({ items: [{ name: '저녁', amount: '1인분', kcal: 1650, confidence: 'low' }], note: '' }) })
    const { last } = await run(s, ateCmd('저녁'))
    // (2,000 + 1,950 + 2,250) / 3 = 2,067
    expect(last.content).toContain('목표 범위를 150 kcal 넘었어요. 이번 주 평균은 범위 안이니 괜찮아요.')
  })

  it('유지 기간이면 유지 범위라고 부른다', async () => {
    const rows = seedRows().map((r) => (r.kind === 'profile' ? { ...r, data: { ...(r.data as object), phase: 'maintain' } } : r))
    const { last } = await run(setup({ rows }), ateCmd('밥'))
    expect(last.content).toContain('오늘 1,160 kcal · 유지 범위 1,900~2,100')
  })

  it('음식을 찾지 못하면 그렇게 말하고 아무것도 쓰지 않는다', async () => {
    const s = setup({ callModel: modelOk({ items: [], note: '음식 이야기가 아니에요.' }) })
    const { last } = await run(s, ateCmd('오늘 날씨 좋다'))
    expect(last.content).toBe('음식을 찾지 못해서 기록하지 않았어요.\n음식 이야기가 아니에요.')
    expect(last.components).toEqual([])
    expect(s.w.upserts()).toHaveLength(0)
  })

  it('칼로리가 0인 항목은 기록하지 않는다', async () => {
    const s = setup({
      callModel: modelOk({
        items: [
          { name: '물', amount: '1컵', kcal: 0, confidence: 'high' },
          { name: '밥', amount: '1공기', kcal: 310, confidence: 'high' },
        ],
        note: '',
      }),
    })
    await run(s, ateCmd('물이랑 밥'))
    expect(s.w.upserts().map((r) => (r.data as MealEntry).name)).toEqual(['밥'])
  })

  it('모델이 쓴 서식 기호와 멘션이 그대로 먹히지 않게 한다', async () => {
    const s = setup({ callModel: modelOk({ items: [{ name: '**굵게** @everyone', amount: '~1~', kcal: 100, confidence: 'low' }], note: '# 제목' }) })
    const { last } = await run(s, ateCmd('밥'))
    expect(last.content).toContain('\\*\\*굵게\\*\\* @everyone · \\~1\\~ · 100 kcal')
    expect(last.content).toContain('\\# 제목')
    expect(last.allowed_mentions).toEqual({ parse: [] })
  })

  it('한도를 넘었으면 차분히 알리고 Claude를 부르지 않는다', async () => {
    const s = setup({ take: -1 })
    const { last } = await run(s, ateCmd('밥'))
    expect(last.content).toBe(MSG.limit)
    expect(s.callModel).not.toHaveBeenCalled()
    expect(s.w.upserts()).toHaveLength(0)
  })

  it('AI_DAILY_LIMIT를 한도로 넘긴다', async () => {
    const s = setup({ env: env({ DISCORD_PUBLIC_KEY: keys.publicKey, AI_DAILY_LIMIT: '7' }) })
    await run(s, ateCmd('밥'))
    expect(s.w.takeCalls()[0].body).toEqual({ p_user: USER_ID, p_limit: 7 })
  })

  it('앱에서 처음 설정을 마치지 않았으면 한 줄로 알리고 횟수를 쓰지 않는다', async () => {
    const s = setup({ rows: seedRows().filter((r) => r.kind !== 'checkin') })
    const { last } = await run(s, ateCmd('밥'))
    expect(last.content).toBe(MSG.notOnboarded)
    expect(s.w.takeCalls()).toHaveLength(0)
    expect(s.callModel).not.toHaveBeenCalled()
  })

  describe('사진', () => {
    const jpeg = new Uint8Array(2048).fill(7)
    const withPhoto = (a: Record<string, unknown>) =>
      command(
        CMD.ate,
        [
          { name: OPT.text, type: 3, value: '밥은 반만 먹었어요' },
          { name: OPT.photo, type: 11, value: 'att-1' },
        ],
        { resolved: { attachments: { 'att-1': { id: 'att-1', url: 'https://cdn.discordapp.com/ephemeral-attachments/1/2/meal.jpg?ex=1', ...a } } } },
      )

    it('사진을 받아 base64로 넘기고, 적은 글은 덧붙인 설명으로 넘긴다', async () => {
      const s = setup({ attachment: jpeg, callModel: modelOk(sampleResults['meal-text']) })
      const { last } = await run(s, withPhoto({ content_type: 'image/jpeg', size: jpeg.length }))
      expect(s.callModel).toHaveBeenCalledWith({
        request: { task: 'meal-photo', imageBase64: Buffer.from(jpeg).toString('base64'), mediaType: 'image/jpeg', note: '밥은 반만 먹었어요' },
        userId: USER_ID,
      })
      expect(last.content).toContain('기록했어요.')
      expect(s.w.upserts()).toHaveLength(2)
    })

    it.each([
      ['너무 큰 사진(적힌 크기)', { content_type: 'image/png', size: MAX_PHOTO_BYTES + 1 }, jpeg, MSG.photoTooBig],
      ['너무 큰 사진(실제 크기)', { content_type: 'image/png', size: 10 }, new Uint8Array(MAX_PHOTO_BYTES + 1), MSG.photoTooBig],
      ['사진이 아닌 파일', { content_type: 'application/pdf', size: 10 }, jpeg, MSG.photoUnreadable],
      ['지원하지 않는 사진 형식', { content_type: 'image/heic', size: 10 }, jpeg, MSG.photoUnreadable],
      ['받지 못한 사진', { content_type: 'image/webp', size: 10 }, null, MSG.photoUnreadable],
      ['디스코드 밖의 주소', { content_type: 'image/jpeg', size: 10, url: 'https://example.com/a.jpg' }, jpeg, MSG.photoUnreadable],
    ])('%s은 받지 않고, 횟수도 쓰지 않는다', async (_name, a, bytes, message) => {
      const s = setup({ attachment: bytes })
      const { last } = await run(s, withPhoto(a))
      expect(last.content).toBe(message)
      expect(s.w.takeCalls()).toHaveLength(0)
      expect(s.callModel).not.toHaveBeenCalled()
      expect(s.w.upserts()).toHaveLength(0)
    })

    it('첨부 정보가 빠져 있으면 읽지 못했다고 알린다', async () => {
      const s = setup()
      const { last } = await run(s, command(CMD.ate, [{ name: OPT.text, type: 3, value: '밥' }, { name: OPT.photo, type: 11, value: 'att-9' }]))
      expect(last.content).toBe(MSG.photoUnreadable)
    })
  })
})

describe('방금 기록 취소 버튼', () => {
  async function logged() {
    const s = setup()
    const { last } = await run(s, ateCmd('김치찌개랑 밥'))
    const customId = (last.components[0] as { components: { custom_id: string }[] }).components[0].custom_id
    return { s, customId }
  }

  it('그 묶음의 식사만 삭제 표시하고, 항목에 취소선을 긋고 버튼을 없앤다', async () => {
    const { s, customId } = await logged()
    const before = s.w.live('meal').length
    const res = await handleInteraction(await signed(button(customId)), s.deps)
    expect(await res.json()).toEqual({ type: 6 })
    await s.wait.settle()

    const batchRows = s.w.rows.filter((r) => (r.data as { batch?: string } | null)?.batch)
    expect(batchRows).toHaveLength(2)
    expect(batchRows.every((r) => r.deleted)).toBe(true)
    // 행을 지우지 않고 표시만 한다. 다른 식사는 그대로다.
    expect(s.w.live('meal')).toHaveLength(before - 2)
    expect(s.w.live('meal').map((r) => r.key)).toContain('m-today')
    expect(s.w.sent.filter((x) => x.method === 'DELETE')).toHaveLength(0)

    const last = s.w.edits().at(-1)
    expect(last?.content).toBe('~~김치찌개 · 250 kcal~~\n~~밥 · 310 kcal~~\n기록을 취소했어요.')
    expect(last?.components).toEqual([])
  })

  it('두 번 눌러도 달라지는 것이 없다', async () => {
    const { s, customId } = await logged()
    await handleInteraction(await signed(button(customId)), s.deps)
    await s.wait.settle()
    const snapshot = JSON.stringify(s.w.rows)
    const res = await handleInteraction(await signed(button(customId)), s.deps)
    expect(await res.json()).toEqual({ type: 6 })
    await s.wait.settle()
    expect(JSON.stringify(s.w.rows)).toBe(snapshot)
    expect(s.w.edits().at(-1)?.content).toBe('~~김치찌개 · 250 kcal~~\n~~밥 · 310 kcal~~\n기록을 취소했어요.')
    expect(s.w.edits().at(-1)?.components).toEqual([])
  })

  it('찾을 수 없는 묶음이면 그렇게 알리고 버튼을 없앤다', async () => {
    const s = setup()
    await handleInteraction(await signed(button(`${UNDO_PREFIX}0000000000000000`)), s.deps)
    await s.wait.settle()
    expect(s.w.edits().at(-1)).toMatchObject({ content: MSG.undoMissing, components: [] })
    expect(JSON.stringify(s.w.rows)).toBe(JSON.stringify(seedRows()))
  })

  it('이상한 custom_id는 조회하지 않는다', async () => {
    const s = setup()
    await handleInteraction(await signed(button(`${UNDO_PREFIX}x") or 1=1`)), s.deps)
    await s.wait.settle()
    expect(s.w.edits().at(-1)?.content).toBe(MSG.undoMissing)
    expect(s.w.sent.filter((x) => x.url.includes('supabase'))).toHaveLength(0)
  })
})

describe(`/${CMD.weight}`, () => {
  const weightCmd = (kg: unknown) => command(CMD.weight, [{ name: OPT.kg, type: 10, value: kg }])

  it('오늘 체중을 소수 첫째 자리로 쓰고 추세 체중과 함께 답한다', async () => {
    const s = setup()
    const { first, last } = await run(s, weightCmd(79.04))
    expect(first).toEqual({ type: 5 })
    const written = s.w.upserts()
    expect(written).toEqual([{ user_id: USER_ID, kind: 'weight', key: TODAY, data: { date: TODAY, kg: 79 } satisfies WeightEntry, deleted: false }])
    expect(last.content).toBe('오늘 체중 79.0 kg을 기록했어요. 추세 체중은 79.5 kg이에요.')
    expect(s.callModel).not.toHaveBeenCalled()
    expect(s.w.takeCalls()).toHaveLength(0)
  })

  it('오늘 이미 적은 값이 있으면 고쳐 쓴다', async () => {
    const rows: Row[] = [...seedRows(), { user_id: USER_ID, kind: 'weight', key: TODAY, data: { date: TODAY, kg: 80.1 }, deleted: false }]
    const s = setup({ rows })
    const { last } = await run(s, weightCmd(79))
    expect(last.content).toContain('오늘 체중을 79.0 kg으로 고쳐 기록했어요.')
    expect(s.w.live('weight').filter((r) => r.key === TODAY).map((r) => r.data)).toEqual([{ date: TODAY, kg: 79 }])
  })

  it.each([29.9, 300.1, Number.NaN, '80', undefined])('범위를 벗어난 값 %s은 쓰지 않는다', async (kg) => {
    const s = setup()
    const { last } = await run(s, weightCmd(kg))
    expect(last.content).toBe(MSG.badKg)
    expect(s.w.upserts()).toHaveLength(0)
  })

  it('처음 설정 전이면 한 줄로 알린다', async () => {
    const s = setup({ rows: [] })
    const { last } = await run(s, weightCmd(80))
    expect(last.content).toBe(MSG.notOnboarded)
    expect(s.w.upserts()).toHaveLength(0)
  })
})

describe(`/${CMD.today}`, () => {
  it('AI 없이 오늘 상태, 오늘 식사, 이번 주 평균, 체중 기록 여부를 보여 준다', async () => {
    const s = setup()
    const { last } = await run(s, command(CMD.today))
    expect(last.content).toBe(
      [
        '11월 19일 (목)',
        '오늘 600 kcal · 목표 범위 1,900~2,100',
        '1,300~1,500 kcal 더 먹으면 목표 범위 안이에요.',
        '',
        '오늘 기록한 식사',
        '아침 토스트 · 600 kcal',
        '',
        '이번 주 식사 기록 4일 · 오늘을 뺀 3일 평균 2,083 kcal로 목표 범위 안이에요.',
        '오늘 체중은 아직 기록하지 않았어요.',
      ].join('\n'),
    )
    expect(last.components).toEqual([])
    expect(s.callModel).not.toHaveBeenCalled()
    expect(s.w.takeCalls()).toHaveLength(0)
  })

  it('기록이 없는 날과 체중을 잰 날', async () => {
    const rows: Row[] = [
      ...seedRows().filter((r) => r.kind !== 'meal'),
      { user_id: USER_ID, kind: 'weight', key: TODAY, data: { date: TODAY, kg: 79.3 }, deleted: false },
    ]
    const { last } = await run(setup({ rows }), command(CMD.today))
    expect(last.content).toContain('오늘은 아직 기록한 식사가 없어요.')
    expect(last.content).toContain('이번 주 식사 기록 0일 · 이번 주에는 식사 기록이 아직 없어요.')
    expect(last.content).toContain('오늘 체중 79.3 kg을 기록했어요.')
  })

  it('처음 설정 전이면 한 줄로 알린다', async () => {
    const { last } = await run(setup({ rows: seedRows().filter((r) => r.kind !== 'profile') }), command(CMD.today))
    expect(last.content).toBe(MSG.notOnboarded)
  })
})

describe(`/${CMD.coach}`, () => {
  const coachCmd = (q: string) => command(CMD.coach, [{ name: OPT.question, type: 3, value: q }])

  it('횟수를 하나 쓰고, 내 기록 요약과 질문을 대화 기록 없이 넘겨 답을 보여 준다', async () => {
    const s = setup({ callModel: modelOk({ answer: '외식 날은 범위 위쪽까지 써도 괜찮아요.' }) })
    const { first, last } = await run(s, coachCmd('주말에 외식이 있어요'))
    expect(first).toEqual({ type: 5 })
    expect(s.w.takeCalls()).toHaveLength(1)
    const arg = s.callModel.mock.calls[0][0]
    expect(arg.userId).toBe(USER_ID)
    expect(arg.request).toMatchObject({
      task: 'ask',
      question: '주말에 외식이 있어요',
      history: [],
      context: { today: TODAY, phase: 'lose', targetKcal: 2000, targetLow: 1900, targetHigh: 2100, todayKcal: 600 },
    })
    expect(last.content).toBe('외식 날은 범위 위쪽까지 써도 괜찮아요.')
  })

  it('2000자를 넘는 답은 문장이 끝나는 곳에서 자른다', async () => {
    const answer = '이 문장은 길이를 채우려고 되풀이해요. '.repeat(120)
    const { last } = await run(setup({ callModel: modelOk({ answer }) }), coachCmd('길게'))
    expect(answer.length).toBeGreaterThan(2000)
    expect(last.content.length).toBeLessThanOrEqual(2000)
    expect(last.content.length).toBeGreaterThan(1900)
    expect(last.content.endsWith('되풀이해요.')).toBe(true)
  })

  it('처음 설정 전이면 한 줄로 알리고 횟수를 쓰지 않는다', async () => {
    const s = setup({ rows: [] })
    const { last } = await run(s, coachCmd('안녕'))
    expect(last.content).toBe(MSG.notOnboarded)
    expect(s.w.takeCalls()).toHaveLength(0)
  })
})

describe('미룬 뒤의 실패는 모두 원래 응답을 고쳐 알린다', () => {
  const cases: [string, Setup, unknown, string][] = [
    ['AI가 붐빔', { callModel: async () => ({ ok: false, error: 'busy' }) }, ateCmd('밥'), MSG.aiBusy],
    ['AI 실패', { callModel: async () => ({ ok: false, error: 'failed' }) }, ateCmd('밥'), MSG.aiFailed],
    ['AI 거절', { callModel: async () => ({ ok: false, error: 'refused' }) }, ateCmd('밥'), MSG.aiRefused],
    [
      'AI 호출이 던짐',
      {
        callModel: async () => {
          throw new Error('boom')
        },
      },
      ateCmd('밥'),
      MSG.aiFailed,
    ],
    ['AI가 엉뚱한 모양을 돌려줌', { callModel: modelOk({ answer: 1 }) }, ateCmd('밥'), MSG.aiFailed],
    ['기록을 읽지 못함', { failOn: 'load' }, ateCmd('밥'), MSG.db],
    ['기록을 쓰지 못함', { failOn: 'upsert' }, ateCmd('밥'), MSG.db],
    ['횟수를 확인하지 못함', { failOn: 'usage' }, ateCmd('밥'), MSG.db],
    ['한도 초과', { take: -1 }, command(CMD.coach, [{ name: OPT.question, type: 3, value: '질문' }]), MSG.limit],
    ['코치: AI가 붐빔', { callModel: async () => ({ ok: false, error: 'busy' }) }, command(CMD.coach, [{ name: OPT.question, type: 3, value: '질문' }]), MSG.aiBusy],
    ['체중: 쓰지 못함', { failOn: 'upsert' }, command(CMD.weight, [{ name: OPT.kg, type: 10, value: 80 }]), MSG.db],
    ['오늘: 읽지 못함', { failOn: 'load' }, command(CMD.today), MSG.db],
    ['취소: 찾지 못함', { failOn: 'find' }, button(`${UNDO_PREFIX}abcdef0123456789`), MSG.db],
  ]

  it.each(cases)('%s', async (_name, o, interaction, message) => {
    const s = setup(o)
    const { edits, last } = await run(s, interaction)
    expect(edits).toHaveLength(1)
    expect(last.content).toBe(message)
    expect(last.components).toEqual([])
  })

  it('횟수를 확인하지 못하면 Claude를 부르지 않는다', async () => {
    const s = setup({ failOn: 'usage' })
    await run(s, ateCmd('밥'))
    expect(s.callModel).not.toHaveBeenCalled()
  })

  it('AI 키가 없으면 횟수를 쓰지 않고 알린다', async () => {
    const s = setup({ env: env({ DISCORD_PUBLIC_KEY: keys.publicKey, ANTHROPIC_API_KEY: '' }) })
    const { last } = await run(s, ateCmd('밥'))
    expect(last.content).toBe(MSG.aiOff)
    expect(s.w.takeCalls()).toHaveLength(0)
  })

  it('취소 중에 삭제 표시가 실패해도 알린다', async () => {
    const s = setup()
    const { last } = await run(s, ateCmd('밥'))
    const customId = (last.components[0] as { components: { custom_id: string }[] }).components[0].custom_id
    const s2 = setup({ rows: s.w.rows, failOn: 'delete' })
    const r = await run(s2, button(customId))
    expect(r.last.content).toBe(MSG.db)
    expect(s2.w.rows.filter((x) => (x.data as { batch?: string } | null)?.batch).every((x) => !x.deleted)).toBe(true)
  })

  it('디스코드가 고친 글을 받지 않으면 짧은 안내로 한 번 더 시도하고, 던지지 않는다', async () => {
    const s = setup({ discordFail: 'edit' })
    const { edits } = await run(s, command(CMD.today))
    expect(edits).toHaveLength(2)
    expect(edits[1].content).toBe(MSG.doneUnshown)
  })
})

describe('로그', () => {
  it('무슨 일을 했고 얼마나 걸렸고 어떻게 끝났는지만 남기고, 적은 글과 토큰은 남기지 않는다', async () => {
    const s = setup({ callModel: modelOk({ answer: '코치가쓴답변이에요' }) })
    await run(s, ateCmd('비밀스러운점심메뉴'))
    await run(s, command(CMD.coach, [{ name: OPT.question, type: 3, value: '남에게보이면안되는질문' }]))
    await run(s, command(CMD.weight, [{ name: OPT.kg, type: 10, value: 81.7 }]))
    const out = loggedText(log)
    const lines = log.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>)
    expect(lines.map((l) => l.task)).toEqual(['ate', 'coach', 'weight'])
    for (const l of lines) {
      expect(l.evt).toBe('discord')
      expect(typeof l.ms).toBe('number')
      expect(typeof l.result).toBe('string')
      expect(l.edit).toBe(200)
    }
    for (const secret of [...SECRETS, '비밀스러운점심메뉴', '남에게보이면안되는질문', '코치가쓴답변이에요', '81.7', '김치찌개']) {
      expect(out).not.toContain(secret)
    }
  })

  it('실패한 일도 결과 이름만 남긴다', async () => {
    const s = setup({ failOn: 'load' })
    await run(s, ateCmd('숨겨야하는글'))
    const line = JSON.parse(String(log.mock.calls[0][0])) as Record<string, unknown>
    expect(line).toMatchObject({ evt: 'discord', task: 'ate', result: 'data_load_500', edit: 200 })
    expect(loggedText(log)).not.toContain('숨겨야하는글')
  })
})
