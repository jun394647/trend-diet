import type { Favorite, MealEntry } from '../types'
import { mySuggestions, parseEntry, previousDayMeals } from './quickAdd'

describe('parseEntry', () => {
  it('숫자만 적으면 칼로리다', () => {
    expect(parseEntry('550')).toEqual({ kind: 'kcal', kcal: 550 })
    expect(parseEntry(' 1,200 kcal ')).toEqual({ kind: 'kcal', kcal: 1200 })
    expect(parseEntry('300칼로리')).toEqual({ kind: 'kcal', kcal: 300 })
  })
  it('이름 뒤에 숫자를 붙이면 이름과 칼로리다', () => {
    expect(parseEntry('김치찌개 550')).toEqual({ kind: 'named', name: '김치찌개', kcal: 550 })
    expect(parseEntry('닭가슴살  샐러드 380kcal')).toEqual({ kind: 'named', name: '닭가슴살 샐러드', kcal: 380 })
  })
  it('이름만 적으면 검색어다', () => {
    expect(parseEntry('김치찌개')).toEqual({ kind: 'text', text: '김치찌개' })
    expect(parseEntry('바나나2개')).toEqual({ kind: 'text', text: '바나나2개' })
  })
  it('범위를 벗어난 숫자는 기록하지 않는다', () => {
    expect(parseEntry('0')).toEqual({ kind: 'invalid', kcal: 0 })
    expect(parseEntry('99999')).toEqual({ kind: 'invalid', kcal: 99999 })
    // 이름이 있으면 숫자까지 이름의 일부로 보고 검색한다.
    expect(parseEntry('콜라 99999')).toEqual({ kind: 'text', text: '콜라 99999' })
  })
  it('minNamedKcal보다 작은 숫자가 이름 뒤에 붙으면 칼로리가 아니라 글로 본다', () => {
    expect(parseEntry('계란 2', { minNamedKcal: 20 })).toEqual({ kind: 'text', text: '계란 2' })
    expect(parseEntry('바나나 19kcal', { minNamedKcal: 20 })).toEqual({ kind: 'text', text: '바나나 19kcal' })
    expect(parseEntry('계란 20', { minNamedKcal: 20 })).toEqual({ kind: 'named', name: '계란', kcal: 20 })
    // 숫자만 적은 것은 그대로 칼로리다.
    expect(parseEntry('2', { minNamedKcal: 20 })).toEqual({ kind: 'kcal', kcal: 2 })
    // 옵션을 주지 않으면 예전처럼 읽는다.
    expect(parseEntry('계란 2')).toEqual({ kind: 'named', name: '계란', kcal: 2 })
  })
  it('비어 있으면 empty', () => {
    expect(parseEntry('   ')).toEqual({ kind: 'empty' })
  })
})

const meal = (id: string, date: string, name: string | undefined, kcal: number, source: MealEntry['source'] = 'exact'): MealEntry => ({
  id,
  date,
  name,
  kcal,
  source,
  createdAt: `${date}T12:00:0${id.length % 10}.000Z`,
})

describe('mySuggestions', () => {
  const meals = [
    meal('a', '2026-01-01', '바나나', 90),
    meal('b', '2026-01-02', '바나나', 90),
    meal('c', '2026-01-03', '김치찌개', 550),
    meal('d', '2026-01-03', undefined, 400),
    meal('e', '2026-01-03', '대충 입력 · 보통', 600, 'rough'),
    meal('f', '2026-01-04', '김치찌개', 480),
  ]
  const favorites: Favorite[] = [
    { id: 'f1', name: '바나나', kcal: 90, useCount: 5, lastUsedAt: '2026-01-02T00:00:00.000Z' },
    { id: 'f2', name: '그릭요거트', kcal: 150, useCount: 0, lastUsedAt: '2025-12-01T00:00:00.000Z' },
  ]

  it('자주 먹은 순, 그다음 최근 순으로 준다', () => {
    const s = mySuggestions({ meals, favorites })
    // 바나나와 김치찌개는 둘 다 두 번이라 더 최근에 먹은 김치찌개가 먼저다.
    expect(s.map((x) => `${x.name} ${x.kcal}`)).toEqual(['김치찌개 480', '바나나 90', '그릭요거트 150'])
    expect(s[1]).toMatchObject({ count: 2, favoriteId: 'f1', inHistory: true })
    expect(s[2]).toMatchObject({ favoriteId: 'f2', inHistory: false })
  })
  it('이름 없는 식사와 대충 입력은 넣지 않는다', () => {
    const names = mySuggestions({ meals, favorites }).map((x) => x.name)
    expect(names).not.toContain('대충 입력 · 보통')
    expect(names.every(Boolean)).toBe(true)
  })
  it('검색어가 있으면 이름에 들어 있는 것만 남긴다', () => {
    expect(mySuggestions({ meals, favorites }, '김치').map((x) => x.kcal)).toEqual([480])
    expect(mySuggestions({ meals, favorites }, '그릭 요거').map((x) => x.name)).toEqual(['그릭요거트'])
  })
  it('같은 이름을 여러 칼로리로 기록했으면 가장 자주 쓴 값 하나만 남긴다', () => {
    const many = [
      meal('a', '2026-01-01', '점심', 700),
      meal('bb', '2026-01-02', '점심', 650),
      meal('ccc', '2026-01-03', '점심', 650),
      meal('dddd', '2026-01-04', '점심', 800),
    ]
    expect(mySuggestions({ meals: many, favorites: [] })).toMatchObject([{ name: '점심', kcal: 650, count: 4 }])
  })

  it('AI로 기록한 식사는 같은 이름을 두 번 이상 기록했을 때부터 넣는다', () => {
    const once = [meal('a', '2026-01-01', '바나나', 90), meal('bb', '2026-01-02', '쌀밥', 300, 'ai'), meal('ccc', '2026-01-02', '계란말이', 120, 'ai')]
    expect(mySuggestions({ meals: once, favorites: [] }).map((x) => x.name)).toEqual(['바나나'])
    expect(mySuggestions({ meals: once, favorites: [] }, '쌀밥')).toEqual([])

    const twice = [...once, meal('dddd', '2026-01-03', '쌀밥', 300, 'ai')]
    expect(mySuggestions({ meals: twice, favorites: [] })).toMatchObject([{ name: '쌀밥', kcal: 300, count: 2 }, { name: '바나나' }])

    // 직접 한 번 기록한 이름이면 AI 기록 한 건도 함께 센다.
    const mixed = [...once, meal('eeeee', '2026-01-03', '계란말이', 130)]
    expect(mySuggestions({ meals: mixed, favorites: [] }, '계란')).toMatchObject([{ name: '계란말이', count: 2 }])
  })

  it('limit만큼만 준다', () => {
    expect(mySuggestions({ meals, favorites }, '', 2)).toHaveLength(2)
  })
})

it('previousDayMeals는 전날 식사를 기록한 순서대로 준다', () => {
  const meals = [meal('bb', '2026-01-02', '저녁', 700), meal('a', '2026-01-02', '점심', 600), meal('c', '2026-01-03', '아침', 300)]
  expect(previousDayMeals(meals, '2026-01-03').map((m) => m.name)).toEqual(['점심', '저녁'])
  expect(previousDayMeals(meals, '2026-01-02')).toEqual([])
})
