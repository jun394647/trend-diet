import { useStore } from './store'
import { parseBackup } from './storage'
import type { Profile } from './types'

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

beforeEach(async () => {
  await useStore.getState().resetAll()
})

describe('store + storage', () => {
  it('온보딩을 마치면 프로필, 오늘 체중, 첫 계획이 생긴다', async () => {
    await useStore.getState().completeOnboarding(profile)
    const s = useStore.getState()
    expect(s.profile).toEqual(profile)
    expect(s.weights).toHaveLength(1)
    expect(s.weights[0].kg).toBe(80)
    expect(s.checkins).toHaveLength(1)
    expect(s.checkins[0].kind).toBe('initial')
    expect(s.checkins[0].targetKcal).toBeLessThan(s.checkins[0].estimatedTdee)
  })

  it('저장한 내용은 다시 불러와도 그대로다', async () => {
    const st = useStore.getState()
    await st.completeOnboarding(profile)
    await st.addMeal({ date: '2026-01-02', kcal: 512.4, name: ' 점심 ', source: 'exact' })
    await st.addFavorite('닭가슴살', 165)
    useStore.setState({ profile: null, weights: [], meals: [], favorites: [], checkins: [] })
    await useStore.getState().init()
    const s = useStore.getState()
    expect(s.profile).toEqual(profile)
    expect(s.meals[0]).toMatchObject({ kcal: 512, name: '점심' })
    expect(s.favorites[0]).toMatchObject({ name: '닭가슴살', kcal: 165 })
  })

  it('같은 날 체중은 덮어쓴다', async () => {
    const st = useStore.getState()
    await st.setWeight('2026-01-02', 80)
    await st.setWeight('2026-01-02', 79.5)
    expect(useStore.getState().weights).toEqual([{ date: '2026-01-02', kg: 79.5 }])
  })

  it('즐겨찾기로 기록하면 식사가 추가되고 사용 횟수가 오른다', async () => {
    const st = useStore.getState()
    await st.addFavorite('바나나', 90)
    const id = useStore.getState().favorites[0].id
    await st.logFavorite(id, '2026-01-02')
    const s = useStore.getState()
    expect(s.favorites[0].useCount).toBe(1)
    expect(s.meals[0]).toMatchObject({ name: '바나나', kcal: 90, source: 'favorite' })
  })

  it('내보낸 백업을 가져오면 같은 상태로 복원된다', async () => {
    const st = useStore.getState()
    await st.completeOnboarding(profile)
    await st.addMeal({ date: '2026-01-02', kcal: 700, source: 'rough' })
    const text = await st.exportBackup()
    expect(useStore.getState().lastBackupAt).not.toBeNull()
    const before = useStore.getState()
    await st.resetAll()
    expect(useStore.getState().profile).toBeNull()
    await useStore.getState().importBackup(text)
    const after = useStore.getState()
    expect(after.profile).toEqual(before.profile)
    expect(after.weights).toEqual(before.weights)
    expect(after.meals).toEqual(before.meals)
    expect(after.checkins).toEqual(before.checkins)
  })

  it('잘못된 백업은 거부하고 기존 데이터를 건드리지 않는다', async () => {
    const st = useStore.getState()
    await st.completeOnboarding(profile)
    await expect(st.importBackup('not json')).rejects.toThrow(/JSON/)
    await expect(st.importBackup(JSON.stringify({ app: 'other' }))).rejects.toThrow()
    expect(useStore.getState().profile).toEqual(profile)
  })

  it('프로필을 바꾸면 추정 소비 칼로리는 유지하고 목표만 다시 계산한다', async () => {
    const st = useStore.getState()
    await st.completeOnboarding(profile)
    const before = useStore.getState().checkins[0]
    await st.updateProfile({ ...profile, weeklyLossKg: 0.25 })
    const after = useStore.getState().checkins
    expect(after).toHaveLength(1)
    expect(after[0].estimatedTdee).toBe(before.estimatedTdee)
    expect(after[0].targetKcal).toBeGreaterThan(before.targetKcal)
  })
})

describe('parseBackup', () => {
  it('손상된 항목을 거부한다', () => {
    const base = { app: 'trend-diet', version: 1, weights: [], meals: [], favorites: [], checkins: [] }
    expect(() => parseBackup({ ...base, weights: [{ date: '2026/01/01', kg: 80 }] })).toThrow(/체중/)
    expect(() => parseBackup({ ...base, meals: [{ id: 'a', date: '2026-01-01', kcal: 'x' }] })).toThrow(/식사/)
    expect(() => parseBackup({ ...base, version: 2 })).toThrow(/버전/)
    expect(parseBackup(base).profile).toBeNull()
  })
})
