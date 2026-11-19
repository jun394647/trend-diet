/**
 * 디스코드로 보내는 글. 숫자는 앱과 같은 규칙(src/lib)으로 셈하고,
 * 문장은 앱의 오늘 화면(src/pages/Today.tsx)과 같은 말로 쓴다.
 */
import { currentPlan, type Plan } from '../../src/lib/plan.ts'
import { kcalOn } from '../../src/lib/selectors.ts'
import { intakeState, phaseOf, targetRange, weekSummary, type IntakeState, type Range, type WeekSummary } from '../../src/lib/sustain.ts'
import type { UserData } from '../data/records.ts'
import type { Profile } from '../../src/types.ts'
import { MESSAGE_LIMIT } from './api.ts'

export const MSG = {
  notOwner: '이 봇은 주인만 쓸 수 있어요.',
  notOnboarded: '앱에서 먼저 처음 설정을 마쳐 주세요. 그 뒤에 여기서 기록할 수 있어요.',
  notConfigured: '서버 설정이 아직 끝나지 않았어요.',
  unknown: '알 수 없는 명령이에요.',
  db: '기록을 읽거나 저장하지 못했어요. 잠시 뒤에 다시 해 주세요.',
  limit: '오늘 쓸 수 있는 AI 횟수를 다 썼어요. 내일 다시 쓸 수 있고, 앱에서는 지금도 직접 기록할 수 있어요.',
  aiBusy: '지금은 AI가 붐벼서 답을 받지 못했어요. 잠시 뒤에 다시 해 주세요.',
  aiRefused: '이 내용에는 AI가 답하지 않았어요. 다르게 적어서 다시 보내 주세요.',
  aiFailed: 'AI 쪽에 문제가 생겨 처리하지 못했어요. 잠시 뒤에 다시 해 주세요.',
  aiOff: 'AI 기능이 아직 설정되지 않았어요.',
  failed: '처리하지 못했어요. 잠시 뒤에 다시 해 주세요.',
  doneUnshown: '처리는 끝났는데 결과를 보여 주지 못했어요. /오늘 로 확인해 주세요.',
  emptyText: '무엇을 먹었는지 적어서 다시 보내 주세요.',
  photoTooBig: '사진이 너무 커요. 3MB 이하의 사진으로 다시 보내 주세요.',
  photoUnreadable: '사진을 읽지 못했어요. JPEG, PNG, WebP 사진으로 다시 보내 주세요.',
  noFood: '음식을 찾지 못해서 기록하지 않았어요.',
  badKg: '체중은 30에서 300 사이의 숫자로 적어 주세요.',
  emptyQuestion: '묻고 싶은 것을 적어서 다시 보내 주세요.',
  undone: '기록을 취소했어요.',
  undoMissing: '취소할 기록을 찾지 못했어요. 앱에서 이미 지웠을 수 있어요.',
  estimate: '숫자는 어림값이에요.',
} as const

export const fmtKcal = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
export const fmtKg = (n: number): string => n.toFixed(1)

/** 모델이나 사용자가 쓴 글이 디스코드에서 서식으로 읽히지 않게 한다. */
export function plain(s: string): string {
  return s.replace(/\s+/g, ' ').trim().replace(/([\\*_~`|>#[\]()])/g, '\\$1')
}

/** 디스코드 글자 수 제한에 맞춘다. 넘치면 되도록 문장이 끝나는 곳에서 자른다. */
export function fitMessage(text: string, max = MESSAGE_LIMIT): string {
  const t = text.trim()
  if (t.length <= max) return t
  let cut = t.slice(0, max - 1)
  // 이모지 같은 두 칸짜리 글자의 앞쪽 절반만 남지 않게 한다.
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  let end = -1
  for (const m of cut.matchAll(/[.?。\n](?=\s|$)/g)) end = m.index
  if (end >= max / 2) return cut.slice(0, end + 1).trimEnd()
  return `${cut.trimEnd()}…`
}

export function rangeNameOf(profile: Profile): string {
  return phaseOf(profile) === 'maintain' ? '유지 범위' : '목표 범위'
}

/** 앱에서 처음 설정을 마쳤으면 프로필과 지금 계획을, 아니면 null을 돌려준다. */
export function onboarded(data: UserData): { profile: Profile; plan: Plan } | null {
  const plan = currentPlan(data.checkins)
  return data.profile && plan ? { profile: data.profile, plan } : null
}

export interface DayStatus {
  eaten: number
  range: Range
  state: IntakeState
  week: WeekSummary
  rangeName: string
}

export function dayStatus(data: UserData, profile: Profile, plan: Plan, today: string): DayStatus {
  const eaten = kcalOn(data.meals, today)
  return {
    eaten,
    range: targetRange(plan.targetKcal),
    state: intakeState(eaten, plan.targetKcal),
    week: weekSummary({ meals: data.meals, weights: data.weights, targetKcal: plan.targetKcal, asOf: today, inProgress: today }),
    rangeName: rangeNameOf(profile),
  }
}

/** '오늘 1,350 kcal · 목표 범위 1,900~2,100' */
export function headline(s: DayStatus): string {
  return `오늘 ${fmtKcal(s.eaten)} kcal · ${s.rangeName} ${fmtKcal(s.range.low)}~${fmtKcal(s.range.high)}`
}

/** 오늘 화면의 한 줄과 같은 말: 범위 안 / 얼마 더 들어가는지 / 넘었지만 한 주 평균으로 본다. */
export function todayLine(s: DayStatus): string {
  if (s.state === 'in') return `${s.rangeName} 안이에요.`
  if (s.state === 'under') {
    return `${fmtKcal(s.range.low - s.eaten)}~${fmtKcal(s.range.high - s.eaten)} kcal 더 먹으면 ${s.rangeName} 안이에요.`
  }
  const tail = s.week.avgState === 'in' ? '이번 주 평균은 범위 안이니 괜찮아요.' : '하루쯤은 괜찮아요. 한 주 평균으로 봐요.'
  return `${s.rangeName}를 ${fmtKcal(s.eaten - s.range.high)} kcal 넘었어요. ${tail}`
}

/** 오늘 화면의 한 주 요약과 같은 말. */
export function weekLine(week: WeekSummary, rangeName: string): string {
  if (week.avgKcal === null) return '이번 주에는 식사 기록이 아직 없어요.'
  const head = `${week.avgDays < week.mealDays ? '오늘을 뺀 ' : '기록한 '}${week.avgDays}일 평균 ${fmtKcal(week.avgKcal)} kcal로 `
  if (week.avgState === 'in') return `${head}${rangeName} 안이에요.`
  if (week.avgState === 'over') return `${head}${rangeName}보다 조금 많아요.`
  return `${head}${rangeName}보다 적어요. 너무 적게 먹으면 오래 가기 어려워요.`
}
