/** 날짜는 모두 로컬 기준 'YYYY-MM-DD' 문자열로 다룬다. */
export type DateStr = string

export type Sex = 'M' | 'F'

export interface Profile {
  heightCm: number
  birthYear: number
  sex: Sex
  /** 활동 계수 1.2 ~ 1.9 */
  activityFactor: number
  startWeightKg: number
  goalWeightKg: number
  /** 주당 감량 목표(kg). 0이면 유지. */
  weeklyLossKg: number
  createdAt: string
}

export interface WeightEntry {
  date: DateStr
  kg: number
}

export type MealSource = 'exact' | 'favorite' | 'rough' | 'search'

export interface MealEntry {
  id: string
  date: DateStr
  name?: string
  kcal: number
  source: MealSource
  createdAt: string
}

export interface Favorite {
  id: string
  name: string
  kcal: number
  useCount: number
  lastUsedAt: string
}

/** 목표 칼로리 스냅샷. 온보딩 때 'initial' 1건, 이후 주간 체크인마다 'weekly' 1건. */
export interface Checkin {
  date: DateStr
  kind: 'initial' | 'weekly'
  /** 체크인 시점의 추세 체중. 체중 기록이 없으면 null. */
  trendKg: number | null
  estimatedTdee: number
  targetKcal: number
  createdAt: string
}

export interface BackupFile {
  app: 'trend-diet'
  version: 1
  exportedAt: string
  profile: Profile | null
  weights: WeightEntry[]
  meals: MealEntry[]
  favorites: Favorite[]
  checkins: Checkin[]
}
