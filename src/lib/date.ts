import type { DateStr } from '../types.ts'

const pad = (n: number) => String(n).padStart(2, '0')

export function toDateStr(d: Date): DateStr {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function today(): DateStr {
  return toDateStr(new Date())
}

/** 'YYYY-MM-DD'를 로컬 자정 Date로 변환한다. */
export function parseDate(s: DateStr): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(s: DateStr, n: number): DateStr {
  const d = parseDate(s)
  d.setDate(d.getDate() + n)
  return toDateStr(d)
}

/** b - a (일 단위). */
export function diffDays(a: DateStr, b: DateStr): number {
  const ms = parseDate(b).getTime() - parseDate(a).getTime()
  return Math.round(ms / 86_400_000)
}

/** '11월 16일 (월)' 형태. */
export function formatKorean(s: DateStr): string {
  const d = parseDate(s)
  const dow = ['일', '월', '화', '수', '목', '금', '토'][d.getDay()]
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${dow})`
}

/** '11/16' 형태. 차트 축용. */
export function formatShort(s: DateStr): string {
  const d = parseDate(s)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
