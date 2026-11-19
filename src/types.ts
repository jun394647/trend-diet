/** 날짜는 모두 로컬 기준 'YYYY-MM-DD' 문자열로 다룬다. */
export type DateStr = string

export type Sex = 'M' | 'F'

/** 'lose'는 감량 기간, 'maintain'은 유지 기간(쉬어 가기 포함). */
export type Phase = 'lose' | 'maintain'

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
  /** 지금 단계. 없으면 weeklyLossKg가 0보다 클 때 'lose'로 본다. */
  phase?: Phase
  /** 지금 단계를 시작한 날. 없으면 createdAt의 날짜로 본다. */
  phaseStartedAt?: DateStr
  /** 잠시 쉬어 가는 유지 기간이면 끝나는 날. 계속 유지하는 중이면 없음. */
  breakUntil?: DateStr | null
  createdAt: string
}

export interface WeightEntry {
  date: DateStr
  kg: number
}

/** 'ai'는 AI가 추정해 기록한 식사. */
export type MealSource = 'exact' | 'favorite' | 'rough' | 'search' | 'ai'

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
