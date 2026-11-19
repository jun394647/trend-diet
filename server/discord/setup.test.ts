// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { COMMANDS } from './commands.ts'
import { handleSetup } from './setup.ts'
import { APP_ID, BOT_TOKEN, CRON_SECRET, OWNER, SECRETS, env, loggedText, world, type WorldOptions } from './testkit.ts'

let log: MockInstance<typeof console.log>
beforeEach(() => {
  log = vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  vi.restoreAllMocks()
})

const ENV = env({ DISCORD_PUBLIC_KEY: 'ab'.repeat(32) })
const post = (auth: string | null = `Bearer ${CRON_SECRET}`) =>
  new Request('https://diet.example.com/api/discord?setup=1', { method: 'POST', headers: auth ? { Authorization: auth } : {} })

async function run(o: WorldOptions = {}, e = ENV, auth?: string | null) {
  const w = world(o)
  const res = await handleSetup(post(auth), { env: e, fetch: w.fetch })
  return { w, res, body: (await res.json()) as Record<string, Record<string, unknown>> & { ok: boolean } }
}

describe('POST /api/discord?setup=1', () => {
  it.each([null, 'Bearer wrong', `Bearer ${CRON_SECRET}x`, CRON_SECRET])('비밀값이 맞지 않으면(%s) 401이고 디스코드를 부르지 않는다', async (auth) => {
    const { w, res } = await run({}, ENV, auth)
    expect(res.status).toBe(401)
    expect(w.sent).toHaveLength(0)
  })

  it('CRON_SECRET이 설정되지 않았으면 누구도 통과하지 못한다', async () => {
    const { res } = await run({}, { ...ENV, CRON_SECRET: '' }, 'Bearer ')
    expect(res.status).toBe(401)
  })

  it.each(['DISCORD_BOT_TOKEN', 'DISCORD_PUBLIC_KEY', 'DISCORD_APPLICATION_ID', 'DISCORD_OWNER_ID'])('%s가 없으면 503 JSON', async (name) => {
    const { w, res, body } = await run({}, { ...ENV, [name]: undefined })
    expect(res.status).toBe(503)
    expect(body).toEqual({ ok: false, error: 'not_configured' })
    expect(w.sent).toHaveLength(0)
  })

  it('명령을 등록하고, 받을 주소를 정하고, 주인에게 확인 메시지를 보낸다', async () => {
    const { w, res, body } = await run()
    expect(res.status).toBe(200)
    expect(body).toEqual({
      ok: true,
      commands: { ok: true, status: 200, count: 4 },
      endpoint: { ok: true, status: 200, url: 'https://diet.example.com/api/discord' },
      dm: { ok: true, status: 200 },
    })
    expect(w.sent.map((s) => `${s.method} ${s.url.replace('https://discord.com/api/v10', '')}`)).toEqual([
      `PUT /applications/${APP_ID}/commands`,
      'PATCH /applications/@me',
      'POST /users/@me/channels',
      'POST /channels/dm-1/messages',
    ])
    for (const s of w.sent) expect(s.headers.authorization).toBe(`Bot ${BOT_TOKEN}`)
    expect(w.sent[0].body).toEqual(COMMANDS)
    expect(w.sent[1].body).toEqual({ interactions_endpoint_url: 'https://diet.example.com/api/discord' })
    expect(w.sent[2].body).toEqual({ recipient_id: OWNER })
    expect(w.dms()).toEqual([{ content: '디스코드 연결이 끝났어요. /오늘 을 보내 보세요.', components: [], allowed_mentions: { parse: [] } }])
    expect(loggedText(log)).not.toContain(BOT_TOKEN)
    for (const secret of SECRETS) expect(JSON.stringify(body)).not.toContain(secret)
  })

  it('다시 불러도 같은 호출을 같은 내용으로 한다', async () => {
    const a = await run()
    const b = await run()
    expect(b.w.sent).toEqual(a.w.sent)
    expect(b.body).toEqual(a.body)
  })

  it.each([
    ['commands', 'commands'],
    ['endpoint', 'endpoint'],
    ['dm-channel', 'dm'],
    ['dm-message', 'dm'],
  ] as const)('%s 단계가 실패하면 디스코드의 오류 본문을 돌려주고 나머지는 계속한다', async (fail, key) => {
    const { res, body } = await run({ discordFail: fail })
    expect(res.status).toBe(502)
    expect(body.ok).toBe(false)
    expect(body[key]).toMatchObject({ ok: false, status: 403, error: { message: 'Discord says no', code: 50007 } })
    for (const other of ['commands', 'endpoint', 'dm'].filter((k) => k !== key)) expect(body[other].ok).toBe(true)
  })
})

describe('등록하는 명령', () => {
  it('이름과 옵션 이름이 한국어이고, 서버와 DM 어디서나 쓸 수 있게 등록한다', () => {
    expect(COMMANDS.map((c) => c.name)).toEqual(['먹었어', '체중', '오늘', '코치'])
    for (const c of COMMANDS) {
      expect(c.type).toBe(1)
      expect(c.integration_types).toEqual([0, 1])
      expect(c.contexts).toEqual([0, 1, 2])
      expect(c.name).toMatch(/^[\p{L}\p{N}_-]{1,32}$/u)
      expect(c.description.length).toBeGreaterThan(0)
      expect(c.description.length).toBeLessThanOrEqual(100)
      expect(c.description).not.toMatch(/[!！]/)
    }
    const opts = (name: string) => (COMMANDS.find((c) => c.name === name) as { options?: Record<string, unknown>[] }).options ?? []
    expect(opts('먹었어')).toMatchObject([
      { name: '내용', type: 3, required: true },
      { name: '사진', type: 11, required: false },
    ])
    expect(opts('체중')).toMatchObject([{ name: 'kg', type: 10, required: true, min_value: 30, max_value: 300 }])
    expect(opts('오늘')).toEqual([])
    expect(opts('코치')).toMatchObject([{ name: '질문', type: 3, required: true }])
  })
})
