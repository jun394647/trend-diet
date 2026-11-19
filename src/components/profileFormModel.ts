import { PACES, phaseOf, phaseStart } from '../lib/sustain'
import { KCAL_PER_KG } from '../lib/tdee'
import type { DateStr, Profile, Sex } from '../types'

/** 입력 중인 프로필. 숫자 칸은 타이핑을 막지 않도록 문자열로 들고 있는다. */
export interface ProfileDraft {
  sex: Sex | ''
  birthYear: string
  heightCm: string
  /** 현재 체중. 온보딩에서만 입력한다. */
  weightKg: string
  activityFactor: number
  goalWeightKg: string
  weeklyLossKg: number
}

export type ProfileField = 'sex' | 'birthYear' | 'heightCm' | 'weightKg' | 'goalWeightKg'
export type ProfileErrors = Partial<Record<ProfileField, string>>
export type ProfileSection = 'body' | 'activity' | 'goal'

export const ACTIVITY_OPTIONS = [
  { value: 1.2, label: '거의 앉아서 생활', hint: '사무직, 운동은 거의 하지 않아요' },
  { value: 1.375, label: '가벼운 활동', hint: '자주 걷거나 주 1~2회 가볍게 운동해요' },
  { value: 1.55, label: '주 3~5회 운동', hint: '땀이 날 정도의 운동을 꾸준히 해요' },
  { value: 1.725, label: '매일 강한 운동', hint: '매일 강하게 운동하거나 몸을 많이 쓰는 일을 해요' },
] as const

/** 고를 수 있는 속도. 감량 세 가지와 유지. */
export const PACE_OPTIONS: readonly {
  value: number
  label: string
  hint: string
  recommended?: boolean
}[] = [
  { value: PACES[0], label: '천천히', hint: '가장 오래 이어 가기 쉬워요' },
  { value: PACES[1], label: '보통', hint: '무리하지 않으면서 변화가 보여요', recommended: true },
  { value: PACES[2], label: '빠르게', hint: '배고픔이 커서 오래 하기 어려울 수 있어요' },
  { value: 0, label: '유지', hint: '지금 체중을 지키는 게 목표예요' },
]

/** 그 속도로 빼려면 하루에 덜 먹어야 하는 양(kcal). 10 단위로 반올림한다. */
export function dailyDeficit(weeklyLossKg: number): number {
  return Math.round((weeklyLossKg * KCAL_PER_KG) / 7 / 10) * 10
}

/**
 * 내 정보를 저장할 때 단계를 어떻게 둘지 정한다.
 * 속도를 유지(0)로 바꾸거나 유지에서 감량 속도로 바꿀 때만 단계가 바뀌고, 그 밖에는 그대로 둔다.
 */
export function phasePatchForPace(
  profile: Profile,
  nextWeeklyLossKg: number,
  date: DateStr,
): Pick<Profile, 'phase' | 'phaseStartedAt' | 'breakUntil'> | null {
  if (nextWeeklyLossKg === profile.weeklyLossKg) return null
  if (nextWeeklyLossKg === 0) {
    // 쉬어 가던 중이었다면 시작한 날은 그대로 두고, 끝나는 날만 없앤다.
    const already = phaseOf(profile) === 'maintain'
    return {
      phase: 'maintain',
      phaseStartedAt: already ? phaseStart(profile) : date,
      breakUntil: null,
    }
  }
  if (profile.weeklyLossKg === 0) return { phase: 'lose', phaseStartedAt: date, breakUntil: null }
  return null
}

export const SECTION_FIELDS: Record<ProfileSection, ProfileField[]> = {
  body: ['sex', 'birthYear', 'heightCm', 'weightKg'],
  activity: [],
  goal: ['goalWeightKg'],
}

export function emptyDraft(): ProfileDraft {
  return {
    sex: '',
    birthYear: '',
    heightCm: '',
    weightKg: '',
    activityFactor: 1.375,
    goalWeightKg: '',
    weeklyLossKg: 0.5,
  }
}

export function draftFromProfile(p: Profile): ProfileDraft {
  return {
    sex: p.sex,
    birthYear: String(p.birthYear),
    heightCm: String(p.heightCm),
    weightKg: String(p.startWeightKg),
    activityFactor: p.activityFactor,
    goalWeightKg: String(p.goalWeightKg),
    weeklyLossKg: p.weeklyLossKg,
  }
}

/** '72,5'처럼 쉼표를 소수점으로 쓴 입력도 받는다. 숫자가 아니면 NaN. */
export function parseNum(s: string): number {
  const t = s.trim().replace(',', '.')
  if (t === '' || !/^\d+(\.\d+)?$/.test(t)) return NaN
  return Number(t)
}

const inRange = (n: number, min: number, max: number) => Number.isFinite(n) && n >= min && n <= max

/**
 * 프로필 입력값을 검사한다.
 * currentWeightKg를 주면 현재 체중 칸은 검사하지 않고 그 값을 목표 체중 비교에 쓴다(설정 화면용).
 */
export function validateDraft(
  d: ProfileDraft,
  opts: { year: number; currentWeightKg?: number },
): ProfileErrors {
  const e: ProfileErrors = {}

  if (d.sex === '') e.sex = '성별을 골라 주세요.'

  const birth = parseNum(d.birthYear)
  if (!Number.isInteger(birth) || d.birthYear.trim().length !== 4) {
    e.birthYear = '태어난 해를 숫자 4자리로 입력해 주세요.'
  } else {
    const age = opts.year - birth
    if (age < 14 || age > 100) e.birthYear = '14세부터 100세까지 사용할 수 있어요. 태어난 해를 확인해 주세요.'
  }

  if (!inRange(parseNum(d.heightCm), 100, 250)) e.heightCm = '키는 100~250cm 사이로 입력해 주세요.'

  let current = opts.currentWeightKg
  if (current === undefined) {
    const w = parseNum(d.weightKg)
    if (inRange(w, 30, 300)) current = w
    else e.weightKg = '체중은 30~300kg 사이로 입력해 주세요.'
  }

  const goal = parseNum(d.goalWeightKg)
  if (!inRange(goal, 30, 300)) {
    e.goalWeightKg = '목표 체중은 30~300kg 사이로 입력해 주세요.'
  } else if (d.weeklyLossKg > 0 && current !== undefined && goal > current) {
    e.goalWeightKg = `목표 체중이 현재 체중(${current}kg)보다 높아요. 체중을 유지하려면 감량 속도에서 '유지'를 골라 주세요.`
  }

  return e
}

/** 검사를 통과한 입력값을 프로필 필드로 바꾼다. startWeightKg와 createdAt은 호출하는 쪽에서 채운다. */
export function draftToProfileFields(
  d: ProfileDraft,
): Omit<Profile, 'startWeightKg' | 'createdAt'> {
  return {
    sex: d.sex === '' ? 'F' : d.sex,
    birthYear: parseNum(d.birthYear),
    heightCm: parseNum(d.heightCm),
    activityFactor: d.activityFactor,
    goalWeightKg: parseNum(d.goalWeightKg),
    weeklyLossKg: d.weeklyLossKg,
  }
}
