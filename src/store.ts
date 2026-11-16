import { create } from 'zustand'
import { today } from './lib/date'
import { buildInitialCheckin, currentPlan } from './lib/plan'
import { latestCheckin } from './lib/selectors'
import { computeTarget } from './lib/tdee'
import { computeTrend, trendAt } from './lib/trend'
import * as storage from './storage'
import type {
  Checkin,
  DateStr,
  Favorite,
  MealEntry,
  MealSource,
  Profile,
  WeightEntry,
} from './types'

const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

const byDate = <T extends { date: string }>(a: T, b: T) => a.date.localeCompare(b.date)

export interface AppState {
  ready: boolean
  profile: Profile | null
  weights: WeightEntry[]
  meals: MealEntry[]
  favorites: Favorite[]
  checkins: Checkin[]
  lastBackupAt: string | null

  init: () => Promise<void>
  /** 프로필 저장 + 오늘 체중 기록 + 첫 계획 생성. */
  completeOnboarding: (profile: Profile) => Promise<void>
  /** 프로필을 바꾸고, 현재 소비 칼로리 추정치는 유지한 채 목표 칼로리만 다시 계산한다. */
  updateProfile: (profile: Profile) => Promise<void>
  setWeight: (date: DateStr, kg: number) => Promise<void>
  removeWeight: (date: DateStr) => Promise<void>
  addMeal: (m: { date: DateStr; kcal: number; name?: string; source: MealSource }) => Promise<void>
  removeMeal: (id: string) => Promise<void>
  addFavorite: (name: string, kcal: number) => Promise<void>
  removeFavorite: (id: string) => Promise<void>
  /** 즐겨찾기를 해당 날짜 식사로 추가하고 사용 횟수를 올린다. */
  logFavorite: (id: string, date: DateStr) => Promise<void>
  /** 주간 체크인 결과를 저장한다. 제안을 받아들이지 않을 때는 이전 값을 그대로 넘긴다. */
  saveCheckin: (c: { date: DateStr; trendKg: number | null; estimatedTdee: number; targetKcal: number }) => Promise<void>
  /** 백업 파일 내용(JSON 문자열)을 만들고 마지막 백업 시각을 기록한다. */
  exportBackup: () => Promise<string>
  /** 백업 JSON 문자열로 전체 데이터를 교체한다. 형식이 틀리면 예외. */
  importBackup: (text: string) => Promise<void>
  resetAll: () => Promise<void>
}

export const useStore = create<AppState>((set, get) => ({
  ready: false,
  profile: null,
  weights: [],
  meals: [],
  favorites: [],
  checkins: [],
  lastBackupAt: null,

  init: async () => {
    const s = await storage.loadAll()
    set({ ...s, ready: true })
  },

  completeOnboarding: async (profile) => {
    const date = today()
    const weight: WeightEntry = { date, kg: profile.startWeightKg }
    const checkin = buildInitialCheckin(profile, date)
    await storage.saveProfile(profile)
    await storage.putWeight(weight)
    await storage.putCheckin(checkin)
    set((s) => ({
      profile,
      weights: [...s.weights.filter((w) => w.date !== date), weight].sort(byDate),
      checkins: [...s.checkins.filter((c) => c.date !== date), checkin].sort(byDate),
    }))
  },

  updateProfile: async (profile) => {
    await storage.saveProfile(profile)
    set({ profile })
    const { checkins, weights } = get()
    const plan = currentPlan(checkins)
    const last = latestCheckin(checkins)
    if (!plan || !last) return
    const date = today()
    const trendKg = trendAt(computeTrend(weights), date)
    const target = computeTarget({
      tdee: plan.tdee,
      weeklyLossKg: profile.weeklyLossKg,
      sex: profile.sex,
      weightKg: trendKg ?? profile.startWeightKg,
    })
    // 체크인 주기는 그대로 두기 위해 마지막 체크인의 목표만 고쳐 쓴다.
    const updated: Checkin = { ...last, targetKcal: target.targetKcal }
    await storage.putCheckin(updated)
    set((s) => ({ checkins: s.checkins.map((c) => (c.date === updated.date ? updated : c)) }))
  },

  setWeight: async (date, kg) => {
    const w: WeightEntry = { date, kg }
    await storage.putWeight(w)
    set((s) => ({ weights: [...s.weights.filter((x) => x.date !== date), w].sort(byDate) }))
  },

  removeWeight: async (date) => {
    await storage.deleteWeight(date)
    set((s) => ({ weights: s.weights.filter((x) => x.date !== date) }))
  },

  addMeal: async ({ date, kcal, name, source }) => {
    const m: MealEntry = {
      id: newId(),
      date,
      kcal: Math.round(kcal),
      name: name?.trim() || undefined,
      source,
      createdAt: new Date().toISOString(),
    }
    await storage.putMeal(m)
    set((s) => ({ meals: [...s.meals, m] }))
  },

  removeMeal: async (id) => {
    await storage.deleteMeal(id)
    set((s) => ({ meals: s.meals.filter((m) => m.id !== id) }))
  },

  addFavorite: async (name, kcal) => {
    const f: Favorite = {
      id: newId(),
      name: name.trim(),
      kcal: Math.round(kcal),
      useCount: 0,
      lastUsedAt: new Date().toISOString(),
    }
    await storage.putFavorite(f)
    set((s) => ({ favorites: [...s.favorites, f] }))
  },

  removeFavorite: async (id) => {
    await storage.deleteFavorite(id)
    set((s) => ({ favorites: s.favorites.filter((f) => f.id !== id) }))
  },

  logFavorite: async (id, date) => {
    const f = get().favorites.find((x) => x.id === id)
    if (!f) return
    const bumped: Favorite = { ...f, useCount: f.useCount + 1, lastUsedAt: new Date().toISOString() }
    await storage.putFavorite(bumped)
    set((s) => ({ favorites: s.favorites.map((x) => (x.id === id ? bumped : x)) }))
    await get().addMeal({ date, kcal: f.kcal, name: f.name, source: 'favorite' })
  },

  saveCheckin: async ({ date, trendKg, estimatedTdee, targetKcal }) => {
    const c: Checkin = {
      date,
      kind: 'weekly',
      trendKg,
      estimatedTdee,
      targetKcal,
      createdAt: new Date().toISOString(),
    }
    await storage.putCheckin(c)
    set((s) => ({ checkins: [...s.checkins.filter((x) => x.date !== date), c].sort(byDate) }))
  },

  exportBackup: async () => {
    const data = await storage.exportBackup()
    const now = new Date().toISOString()
    await storage.setLastBackupAt(now)
    set({ lastBackupAt: now })
    return JSON.stringify(data, null, 2)
  },

  importBackup: async (text) => {
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new Error('백업 파일을 읽을 수 없습니다: JSON 형식이 아님')
    }
    const backup = storage.parseBackup(raw)
    await storage.restoreBackup(backup)
    const s = await storage.loadAll()
    set({ ...s, ready: true })
  },

  resetAll: async () => {
    await storage.wipeAll()
    set({ profile: null, weights: [], meals: [], favorites: [], checkins: [], lastBackupAt: null })
  },
}))
