/**
 * 빠른 식사 입력을 위한 규칙.
 *  - 한 칸에 '550'만 적으면 칼로리, '김치찌개 550'처럼 적으면 이름과 칼로리로 읽는다.
 *  - 전에 기록한 식사는 따로 저장하지 않아도 자주 먹는 순서로 다시 고를 수 있다.
 */
import type { DateStr, Favorite, MealEntry } from '../types.ts'
import { addDays } from './date.ts'
import { normalize } from './foodSearch.ts'

export const MIN_ENTRY_KCAL = 1
export const MAX_ENTRY_KCAL = 5000

export type ParsedEntry =
  | { kind: 'empty' }
  /** 숫자만 적었다. */
  | { kind: 'kcal'; kcal: number }
  /** 이름 뒤에 숫자를 붙였다. */
  | { kind: 'named'; name: string; kcal: number }
  /** 숫자가 범위를 벗어났다. */
  | { kind: 'invalid'; kcal: number }
  /**
   * 이름 뒤에 작은 숫자만 붙였다('계란 2'). 칼로리인지 양인지 알 수 없어, 어느 쪽인지 사용자가 고르게 한다.
   * minNamedKcal을 줬을 때만 나온다.
   */
  | { kind: 'ambiguous'; name: string; kcal: number; text: string }
  /** 이름만 적었다(검색어). outOfRange는 이름 뒤에 범위를 벗어난 숫자를 붙였을 때 true다('회식 6000'). */
  | { kind: 'text'; text: string; outOfRange?: boolean }

const inRange = (n: number) => n >= MIN_ENTRY_KCAL && n <= MAX_ENTRY_KCAL

export interface ParseEntryOptions {
  /**
   * 이름 뒤 숫자가 이 값보다 작으면 칼로리인지 양인지 알 수 없는 것으로 본다('계란 2'는 계란 두 개일 수 있다).
   * 숫자만 적은 경우와, 'kcal'·'칼로리'를 붙여 칼로리라고 밝힌 경우('제로콜라 5kcal')에는 적용하지 않는다.
   */
  minNamedKcal?: number
}

/** 입력 칸의 글자를 해석한다. 숫자의 쉼표와 뒤에 붙인 'kcal', '칼로리'는 무시한다. */
export function parseEntry(raw: string, options: ParseEntryOptions = {}): ParsedEntry {
  const s = raw.trim().replace(/\s+/g, ' ')
  if (s === '') return { kind: 'empty' }
  const m = /^(?:(.*\S)\s+)?(\d{1,3}(?:,\d{3})+|\d+)\s*(kcal|칼로리)?$/i.exec(s)
  if (!m) return { kind: 'text', text: s }
  const kcal = Number(m[2].replaceAll(',', ''))
  const name = m[1]?.trim()
  const explicit = m[3] !== undefined
  if (!inRange(kcal)) return name ? { kind: 'text', text: s, outOfRange: true } : { kind: 'invalid', kcal }
  if (name && !explicit && kcal < (options.minNamedKcal ?? 0)) {
    return { kind: 'ambiguous', name: name.slice(0, 40), kcal, text: s }
  }
  return name ? { kind: 'named', name: name.slice(0, 40), kcal } : { kind: 'kcal', kcal }
}

export interface Suggestion {
  name: string
  kcal: number
  /** 지금까지 기록한 횟수. */
  count: number
  /** 마지막으로 기록한 시각(ISO). */
  lastAt: string
  /** 즐겨찾기로 저장된 항목이면 그 id. */
  favoriteId: string | null
  /** 먹은 기록에 있는 항목인지. 기록에 없고 저장만 해 둔 항목은 지울 수 있다. */
  inHistory: boolean
}

/**
 * 전에 기록한 식사와 즐겨찾기를 합쳐 자주·최근 먹은 순으로 돌려준다.
 * 이름이 없는 식사와 대충 기록은 다시 고를 대상이 아니므로 뺀다.
 * AI가 이름 붙인 식사는 한 번뿐이면 빼고, 같은 이름을 두 번 이상 기록했을 때부터 넣는다.
 * query가 있으면 이름에 그 글자가 들어 있는 것만 남긴다.
 */
export function mySuggestions(
  args: { meals: MealEntry[]; favorites: Favorite[] },
  query = '',
  limit = 8,
): Suggestion[] {
  // 같은 이름을 여러 칼로리로 기록했으면 이름당 하나만 남긴다: 가장 자주 쓴 값, 같으면 가장 최근 값.
  const byName = new Map<string, Map<number, { count: number; lastAt: string }>>()
  const nameCount = new Map<string, number>()
  for (const m of args.meals) if (m.name) nameCount.set(m.name, (nameCount.get(m.name) ?? 0) + 1)
  for (const m of args.meals) {
    if (!m.name || m.source === 'rough') continue
    if (m.source === 'ai' && (nameCount.get(m.name) ?? 0) < 2) continue
    const variants = byName.get(m.name) ?? new Map<number, { count: number; lastAt: string }>()
    const v = variants.get(m.kcal) ?? { count: 0, lastAt: '' }
    v.count++
    if (m.createdAt > v.lastAt) v.lastAt = m.createdAt
    variants.set(m.kcal, v)
    byName.set(m.name, variants)
  }
  const map = new Map<string, Suggestion>()
  for (const [name, variants] of byName) {
    let kcal = 0
    let best = { count: 0, lastAt: '' }
    let total = 0
    let lastAt = ''
    for (const [k, v] of variants) {
      total += v.count
      if (v.lastAt > lastAt) lastAt = v.lastAt
      if (v.count > best.count || (v.count === best.count && v.lastAt > best.lastAt)) {
        best = v
        kcal = k
      }
    }
    map.set(name, { name, kcal, count: total, lastAt, favoriteId: null, inHistory: true })
  }
  for (const f of args.favorites) {
    const cur = map.get(f.name)
    if (!cur) {
      map.set(f.name, { name: f.name, kcal: f.kcal, count: f.useCount, lastAt: f.lastUsedAt, favoriteId: f.id, inHistory: false })
    } else if (cur.kcal === f.kcal) {
      cur.favoriteId = f.id
    }
  }
  const q = normalize(query)
  return [...map.values()]
    .filter((s) => q === '' || normalize(s.name).includes(q))
    .sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt) || a.name.localeCompare(b.name, 'ko'))
    .slice(0, limit)
}

/** date 전날에 기록한 식사. '어제처럼' 한 번에 기록할 때 쓴다. */
export function previousDayMeals(meals: MealEntry[], date: DateStr): MealEntry[] {
  const prev = addDays(date, -1)
  return meals.filter((m) => m.date === prev).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}
