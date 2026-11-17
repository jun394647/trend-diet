import { db } from '../db'
import { useStore } from '../store'
import * as storage from '../storage'
import type { Profile } from '../types'
import { linkAccount, pullChanges, pushChanges, syncOnce, unlinkAccount, type Remote, type RemoteRow } from './engine'

/** 서버를 흉내 내는 메모리 구현. 변경 시각은 올린 순서대로 증가한다. */
class FakeRemote implements Remote {
  rows = new Map<string, RemoteRow>()
  clock = 0
  failNext = false
  async push(rows: RemoteRow[]) {
    if (this.failNext) {
      this.failNext = false
      throw new Error('network')
    }
    for (const r of rows) {
      const updated_at = `2026-01-01T00:00:${String(++this.clock).padStart(9, '0')}Z`
      this.rows.set(`${r.kind}|${r.key}`, { ...structuredClone(r), updated_at })
    }
  }
  async pull(since: string | null) {
    return [...this.rows.values()]
      .filter((r) => since === null || r.updated_at! >= since)
      .sort((a, b) => a.updated_at!.localeCompare(b.updated_at!))
      .map((r) => structuredClone(r))
  }
  live() {
    return [...this.rows.values()].filter((r) => !r.deleted).map((r) => `${r.kind}|${r.key}`).sort()
  }
}

const profile: Profile = {
  heightCm: 175,
  birthYear: 1995,
  sex: 'M',
  activityFactor: 1.375,
  startWeightKg: 80,
  goalWeightKg: 72,
  weeklyLossKg: 0.5,
  createdAt: '2026-01-01T00:00:00.000Z',
}

/** 다른 기기를 흉내 내기 위해 이 기기의 저장소를 통째로 비운다. */
async function freshDevice() {
  await Promise.all(db.tables.map((t) => t.clear()))
}

beforeEach(freshDevice)

describe('올리기와 받기', () => {
  it('기록한 내용이 서버에 올라가고 outbox가 비워진다', async () => {
    const remote = new FakeRemote()
    await storage.putWeight({ date: '2026-01-02', kg: 80 })
    await storage.saveProfile(profile)
    expect(await pushChanges(remote)).toBe(2)
    expect(remote.live()).toEqual(['profile|profile', 'weight|2026-01-02'])
    expect(await db.outbox.count()).toBe(0)
    expect(await pushChanges(remote)).toBe(0)
  })

  it('지운 기록은 삭제 표시로 올라간다', async () => {
    const remote = new FakeRemote()
    await storage.putWeight({ date: '2026-01-02', kg: 80 })
    await pushChanges(remote)
    await storage.deleteWeight('2026-01-02')
    await pushChanges(remote)
    expect(remote.rows.get('weight|2026-01-02')).toMatchObject({ deleted: true, data: null })
  })

  it('올리기에 실패하면 표시가 남아 다음에 다시 올린다', async () => {
    const remote = new FakeRemote()
    await storage.putWeight({ date: '2026-01-02', kg: 80 })
    remote.failNext = true
    await expect(pushChanges(remote)).rejects.toThrow('network')
    expect(await db.outbox.count()).toBe(1)
    await pushChanges(remote)
    expect(remote.live()).toEqual(['weight|2026-01-02'])
  })

  it('다른 기기에서 올린 기록과 삭제를 받아 온다', async () => {
    const remote = new FakeRemote()
    await remote.push([
      { kind: 'weight', key: '2026-01-02', data: { date: '2026-01-02', kg: 79.5 }, deleted: false },
      { kind: 'meal', key: 'm1', data: { id: 'm1', date: '2026-01-02', kcal: 500, source: 'exact', createdAt: 'x' }, deleted: false },
    ])
    expect(await pullChanges(remote)).toBe(2)
    expect(await db.weights.get('2026-01-02')).toEqual({ date: '2026-01-02', kg: 79.5 })
    expect(await db.meals.count()).toBe(1)

    await remote.push([{ kind: 'meal', key: 'm1', data: null, deleted: true }])
    await pullChanges(remote)
    expect(await db.meals.count()).toBe(0)
  })

  it('이미 받은 변경은 다시 받아도 결과가 같다', async () => {
    const remote = new FakeRemote()
    await remote.push([{ kind: 'weight', key: '2026-01-02', data: { date: '2026-01-02', kg: 79.5 }, deleted: false }])
    await pullChanges(remote)
    await pullChanges(remote)
    expect(await db.weights.toArray()).toEqual([{ date: '2026-01-02', kg: 79.5 }])
  })

  it('아직 올리지 않은 기기 쪽 변경은 받아 온 값으로 덮어쓰지 않는다', async () => {
    const remote = new FakeRemote()
    await remote.push([{ kind: 'weight', key: '2026-01-02', data: { date: '2026-01-02', kg: 70 }, deleted: false }])
    await storage.putWeight({ date: '2026-01-02', kg: 80 })
    await pullChanges(remote)
    expect((await db.weights.get('2026-01-02'))?.kg).toBe(80)
    await syncOnce(remote)
    expect(remote.rows.get('weight|2026-01-02')?.data).toEqual({ date: '2026-01-02', kg: 80 })
  })
})

describe('두 기기', () => {
  it('한 기기에서 쓴 기록이 다른 기기에 그대로 나타난다', async () => {
    const remote = new FakeRemote()
    // 기기 A
    await linkAccount(remote, 'u1')
    await useStore.getState().completeOnboarding(profile)
    await useStore.getState().addMeal({ date: '2026-01-02', kcal: 650, name: '점심', source: 'exact' })
    await syncOnce(remote)
    const a = await storage.loadAll()

    // 기기 B
    await freshDevice()
    expect(await linkAccount(remote, 'u1')).toEqual({ status: 'linked' })
    await syncOnce(remote)
    const b = await storage.loadAll()
    expect(b.profile).toEqual(a.profile)
    expect(b.weights).toEqual(a.weights)
    expect(b.meals).toEqual(a.meals)
    expect(b.checkins).toEqual(a.checkins)
  })

  it('전체 삭제도 다른 기기에 전달된다', async () => {
    const remote = new FakeRemote()
    await linkAccount(remote, 'u1')
    await storage.saveProfile(profile)
    await storage.putWeight({ date: '2026-01-02', kg: 80 })
    await syncOnce(remote)
    await storage.wipeAll()
    await syncOnce(remote)
    expect(remote.live()).toEqual([])
  })

  it('백업 가져오기는 서버의 기록도 같은 내용으로 바꾼다', async () => {
    const remote = new FakeRemote()
    await linkAccount(remote, 'u1')
    await storage.putWeight({ date: '2026-01-02', kg: 80 })
    await syncOnce(remote)
    await storage.restoreBackup({
      app: 'trend-diet',
      version: 1,
      exportedAt: '',
      profile,
      weights: [{ date: '2026-02-01', kg: 78 }],
      meals: [],
      favorites: [],
      checkins: [],
    })
    await syncOnce(remote)
    expect(remote.live()).toEqual(['profile|profile', 'weight|2026-02-01'])
  })
})

describe('계정 연결', () => {
  it('계정이 비어 있으면 기기 기록을 모두 올린다', async () => {
    const remote = new FakeRemote()
    await storage.putWeight({ date: '2026-01-02', kg: 80 })
    await pushChanges(new FakeRemote()) // 연결 전에 쌓인 표시는 비워진 상태
    expect(await linkAccount(remote, 'u1')).toEqual({ status: 'linked' })
    await syncOnce(remote)
    expect(remote.live()).toEqual(['weight|2026-01-02'])
  })

  it('양쪽에 기록이 있으면 먼저 묻는다', async () => {
    const remote = new FakeRemote()
    await remote.push([{ kind: 'weight', key: '2026-01-01', data: { date: '2026-01-01', kg: 70 }, deleted: false }])
    await storage.putWeight({ date: '2026-01-02', kg: 80 })
    expect(await linkAccount(remote, 'u1')).toEqual({ status: 'conflict', localCount: 1, remoteCount: 1 })
    expect(await db.weights.count()).toBe(1)
  })

  it("'remote'를 고르면 기기 기록을 계정 기록으로 바꾼다", async () => {
    const remote = new FakeRemote()
    await remote.push([{ kind: 'weight', key: '2026-01-01', data: { date: '2026-01-01', kg: 70 }, deleted: false }])
    await storage.putWeight({ date: '2026-01-02', kg: 80 })
    await linkAccount(remote, 'u1', 'remote')
    await syncOnce(remote)
    expect(await db.weights.toArray()).toEqual([{ date: '2026-01-01', kg: 70 }])
    expect(remote.live()).toEqual(['weight|2026-01-01'])
  })

  it("'merge'를 고르면 합치고, 겹치는 기록은 기기 쪽을 남긴다", async () => {
    const remote = new FakeRemote()
    await remote.push([
      { kind: 'weight', key: '2026-01-01', data: { date: '2026-01-01', kg: 70 }, deleted: false },
      { kind: 'weight', key: '2026-01-02', data: { date: '2026-01-02', kg: 71 }, deleted: false },
    ])
    await storage.putWeight({ date: '2026-01-02', kg: 80 })
    await linkAccount(remote, 'u1', 'merge')
    await syncOnce(remote)
    expect(await db.weights.orderBy('date').toArray()).toEqual([
      { date: '2026-01-01', kg: 70 },
      { date: '2026-01-02', kg: 80 },
    ])
    expect(remote.rows.get('weight|2026-01-02')?.data).toEqual({ date: '2026-01-02', kg: 80 })
  })

  it('이미 연결된 계정이면 다시 묻지 않는다', async () => {
    const remote = new FakeRemote()
    await storage.putWeight({ date: '2026-01-02', kg: 80 })
    await linkAccount(remote, 'u1')
    await syncOnce(remote)
    expect(await linkAccount(remote, 'u1')).toEqual({ status: 'linked' })
  })

  it('연결을 끊어도 기기 기록은 남는다', async () => {
    const remote = new FakeRemote()
    await storage.putWeight({ date: '2026-01-02', kg: 80 })
    await linkAccount(remote, 'u1')
    await syncOnce(remote)
    await unlinkAccount()
    expect(await db.weights.count()).toBe(1)
    // 다시 로그인하면 양쪽에 기록이 있으므로 묻는다.
    expect((await linkAccount(remote, 'u1')).status).toBe('conflict')
  })
})
