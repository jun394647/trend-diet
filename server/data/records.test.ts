// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { SB, SERVICE_KEY, USER_ID, checkin, env, meal, profile, seedRows, world, type Row } from '../discord/testkit.ts'
import { DataError, dataConfig, findMealsByBatch, kstToday, loadUserData, markDeleted, takeAiUse, upsertRecords, type DataConfig } from './records.ts'

const cfg = dataConfig(env()) as DataConfig

describe('dataConfig', () => {
  it('주소 끝의 /를 떼고 서비스 키와 주인 계정을 읽는다', () => {
    expect(cfg).toEqual({ url: SB, serviceKey: SERVICE_KEY, userId: USER_ID })
    expect(dataConfig(env({ SUPABASE_URL: 'https://other.supabase.co' }))?.url).toBe('https://other.supabase.co')
  })

  it.each(['VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'APP_OWNER_USER_ID'])('%s가 없으면 null', (name) => {
    expect(dataConfig(env({ [name]: ' ' }))).toBeNull()
  })

  it('주인 계정이 uuid 모양이 아니면 null', () => {
    expect(dataConfig(env({ APP_OWNER_USER_ID: 'me&kind=eq.x' }))).toBeNull()
  })
})

describe('kstToday', () => {
  it('한국 날짜(UTC+9)를 돌려준다', () => {
    expect(kstToday(new Date('2026-11-18T14:59:59Z'))).toBe('2026-11-18')
    expect(kstToday(new Date('2026-11-18T15:00:00Z'))).toBe('2026-11-19')
    expect(kstToday(new Date('2026-11-18T23:30:00Z'))).toBe('2026-11-19')
    expect(kstToday(new Date('2026-12-31T15:00:00Z'))).toBe('2027-01-01')
  })
})

describe('loadUserData', () => {
  it('지워지지 않은 내 행만 서비스 키로 읽어 종류별로 모은다', async () => {
    const w = world()
    const data = await loadUserData(w.fetch, cfg)
    expect(data.profile).toEqual(profile)
    expect(data.checkins).toEqual([checkin])
    expect(data.meals.map((m) => m.id)).toEqual(['m-mon', 'm-tue', 'm-wed', 'm-today'])
    expect(data.weights.map((x) => x.date)).toEqual(['2026-11-16', '2026-11-18'])
    expect(data.favorites).toEqual([])
    const call = w.sent[0]
    expect(call.method).toBe('GET')
    expect(call.url).toBe(`${SB}/rest/v1/records?select=kind,key,data&user_id=eq.${USER_ID}&deleted=is.false&order=kind.asc,key.asc&limit=1000&offset=0`)
    expect(call.headers).toMatchObject({ apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` })
  })

  it('다른 사람의 행은 섞이지 않는다', async () => {
    const rows: Row[] = [...seedRows(), { user_id: 'someone-else', kind: 'meal', key: 'x', data: meal('x', '2026-11-19', 9999), deleted: false }]
    const data = await loadUserData(world({ rows }).fetch, cfg)
    expect(data.meals.some((m) => m.id === 'x')).toBe(false)
  })

  it('1000건을 넘으면 이어서 읽는다', async () => {
    const many: Row[] = Array.from({ length: 2300 }, (_, i) => ({
      user_id: USER_ID,
      kind: 'meal',
      key: `m${i}`,
      data: meal(`m${i}`, '2026-11-01', 10),
      deleted: false,
    }))
    const w = world({ rows: [...seedRows(), ...many] })
    const data = await loadUserData(w.fetch, cfg)
    expect(data.meals).toHaveLength(2304)
    expect(w.sent.map((s) => new URL(s.url).searchParams.get('offset'))).toEqual(['0', '1000', '2000'])
  })

  it('모양이 맞지 않는 행은 건너뛴다', async () => {
    const bad = (key: string, kind: string, data: unknown): Row => ({ user_id: USER_ID, kind, key, data, deleted: false })
    const rows = [
      ...seedRows(),
      bad('b1', 'meal', null),
      bad('b2', 'meal', { id: 'b2', date: '2026-11-19', kcal: '많이', createdAt: 'x' }),
      bad('b3', 'meal', { id: 'b3', date: '11/19', kcal: 100, createdAt: 'x' }),
      bad('b4', 'weight', { date: '2026-11-19' }),
      bad('b5', 'checkin', { date: '2026-11-20', targetKcal: null }),
      bad('b6', 'favorite', ['x']),
      bad('b7', 'unknown', {}),
    ]
    const data = await loadUserData(world({ rows }).fetch, cfg)
    expect(data.meals).toHaveLength(4)
    expect(data.weights).toHaveLength(2)
    expect(data.checkins).toHaveLength(1)
    expect(data.favorites).toHaveLength(0)
  })

  it('읽지 못하면 단계와 상태만 담은 DataError를 던진다', async () => {
    const err = await loadUserData(world({ failOn: 'load' }).fetch, cfg).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(DataError)
    expect(err).toMatchObject({ step: 'load', status: 500 })
    expect(String((err as Error).message)).not.toContain(SERVICE_KEY)

    const network = (async () => {
      throw new Error('down')
    }) as unknown as typeof fetch
    await expect(loadUserData(network, cfg)).rejects.toMatchObject({ step: 'load', status: 'network' })

    const notArray = (async () => Response.json({ message: 'hm' })) as unknown as typeof fetch
    await expect(loadUserData(notArray, cfg)).rejects.toMatchObject({ step: 'load', status: 'unexpected' })
  })
})

describe('upsertRecords', () => {
  it('(user_id, kind, key)로 합쳐 쓰고, 지워졌던 행은 되살린다', async () => {
    const w = world()
    const again = { ...meal('m-gone', '2026-11-19', 450, '다시 적은 식사') }
    await upsertRecords(w.fetch, cfg, [
      { kind: 'meal', key: 'm-gone', data: again },
      { kind: 'weight', key: '2026-11-19', data: { date: '2026-11-19', kg: 79 } },
    ])
    const call = w.sent[0]
    expect(call.method).toBe('POST')
    expect(call.url).toBe(`${SB}/rest/v1/records?on_conflict=user_id,kind,key`)
    expect(call.headers.prefer).toContain('resolution=merge-duplicates')
    expect(call.headers).toMatchObject({ apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}`, 'content-type': 'application/json' })
    expect(call.body).toEqual([
      { user_id: USER_ID, kind: 'meal', key: 'm-gone', data: again, deleted: false },
      { user_id: USER_ID, kind: 'weight', key: '2026-11-19', data: { date: '2026-11-19', kg: 79 }, deleted: false },
    ])
    expect(w.rows.filter((r) => r.key === 'm-gone')).toEqual([{ user_id: USER_ID, kind: 'meal', key: 'm-gone', data: again, deleted: false }])
  })

  it('쓸 것이 없으면 부르지 않고, 실패하면 DataError를 던진다', async () => {
    const w = world({ failOn: 'upsert' })
    await upsertRecords(w.fetch, cfg, [])
    expect(w.sent).toHaveLength(0)
    await expect(upsertRecords(w.fetch, cfg, [{ kind: 'weight', key: 'k', data: {} }])).rejects.toMatchObject({ step: 'upsert', status: 500 })
  })
})

describe('markDeleted', () => {
  it('행을 지우지 않고 deleted만 true로 바꾼다. 다시 해도 같다', async () => {
    const w = world()
    await markDeleted(w.fetch, cfg, 'meal', ['m-mon', 'm-tue'])
    await markDeleted(w.fetch, cfg, 'meal', ['m-mon', 'm-tue'])
    expect(w.sent.every((s) => s.method === 'PATCH')).toBe(true)
    expect(decodeURIComponent(w.sent[0].url)).toBe(`${SB}/rest/v1/records?user_id=eq.${USER_ID}&kind=eq.meal&key=in.("m-mon","m-tue")`)
    expect(w.sent[0].body).toEqual({ deleted: true })
    expect(w.rows).toHaveLength(seedRows().length)
    expect(w.rows.filter((r) => r.deleted).map((r) => r.key).sort()).toEqual(['m-gone', 'm-mon', 'm-tue'])
    expect(w.rows.find((r) => r.key === 'm-mon')?.data).toEqual(meal('m-mon', '2026-11-16', 2000, '월요일 식사'))
  })

  it('키가 없으면 부르지 않는다', async () => {
    const w = world()
    await markDeleted(w.fetch, cfg, 'meal', [])
    expect(w.sent).toHaveLength(0)
  })
})

describe('findMealsByBatch', () => {
  it('묶음 키가 같은 식사를 지워진 것까지 기록한 순서로 돌려준다', async () => {
    const b = (id: string, at: string, deleted: boolean): Row => ({
      user_id: USER_ID,
      kind: 'meal',
      key: id,
      data: { ...meal(id, '2026-11-19', 100, id), createdAt: at, batch: 'abcdef0123456789' },
      deleted,
    })
    const w = world({ rows: [...seedRows(), b('second', '2026-11-19T03:00:00.001Z', true), b('first', '2026-11-19T03:00:00.000Z', false)] })
    const found = await findMealsByBatch(w.fetch, cfg, 'abcdef0123456789')
    expect(found.map((f) => [f.key, f.deleted])).toEqual([
      ['first', false],
      ['second', true],
    ])
    expect(decodeURIComponent(w.sent[0].url)).toBe(`${SB}/rest/v1/records?select=key,data,deleted&user_id=eq.${USER_ID}&kind=eq.meal&data->>batch=eq.abcdef0123456789`)
    expect(await findMealsByBatch(w.fetch, cfg, 'ffffffffffffffff')).toEqual([])
  })
})

describe('takeAiUse', () => {
  it('ai_take_for를 주인 계정과 한도로 부르고 횟수를 돌려준다', async () => {
    const w = world({ take: 7 })
    expect(await takeAiUse(w.fetch, cfg, 40)).toBe(7)
    expect(w.sent[0]).toMatchObject({ method: 'POST', url: `${SB}/rest/v1/rpc/ai_take_for`, body: { p_user: USER_ID, p_limit: 40 } })
    expect(w.sent[0].headers).toMatchObject({ apikey: SERVICE_KEY, authorization: `Bearer ${SERVICE_KEY}` })
  })

  it('한도를 넘으면 -1, 알 수 없는 답이나 실패는 null', async () => {
    expect(await takeAiUse(world({ take: -1 }).fetch, cfg, 40)).toBe(-1)
    expect(await takeAiUse(world({ take: 0 }).fetch, cfg, 40)).toBeNull()
    expect(await takeAiUse(world({ take: '3' }).fetch, cfg, 40)).toBeNull()
    expect(await takeAiUse(world({ take: { count: 3 } }).fetch, cfg, 40)).toBeNull()
    expect(await takeAiUse(world({ failOn: 'usage' }).fetch, cfg, 40)).toBeNull()
  })
})
