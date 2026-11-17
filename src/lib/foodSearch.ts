/** 내장 음식 DB의 한 항목. 영양소는 100g(ml)당 값이다. */
export interface Food {
  name: string
  /** 업체명, 또는 업체가 없으면 '가정식' · '외식' · '급식' · '원재료' 같은 구분. */
  tag: string
  kcalPer100: number
  /** 1회 제공량. 정보가 없으면 null. */
  servingSize: number | null
  unit: 'g' | 'ml'
  carbPer100: number | null
  proteinPer100: number | null
  fatPer100: number | null
}

/** public/food-db.json의 한 행: [이름, 구분, kcal, 1회 제공량, 단위, 탄수화물, 단백질, 지방] */
export type FoodRow = [
  string,
  string,
  number,
  number | null,
  'g' | 'ml',
  number | null,
  number | null,
  number | null,
]

export interface FoodDbFile {
  source: string
  updated: string
  items: FoodRow[]
}

export interface IndexedFood extends Food {
  /** 검색용으로 정규화한 이름. */
  nName: string
  /** 검색용으로 정규화한 이름 + 구분. */
  nAll: string
}

/** 공백과 구두점을 없애고 소문자로 바꾼다. '카페 라떼(ICED)' → '카페라떼iced' */
export function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s·ㆍ_()[\]{},./\\\-+&'"!?:;~]/g, '')
}

export function buildIndex(rows: FoodRow[]): IndexedFood[] {
  return rows.map(([name, tag, kcalPer100, servingSize, unit, carbPer100, proteinPer100, fatPer100]) => {
    const nName = normalize(name)
    return {
      name,
      tag,
      kcalPer100,
      servingSize,
      unit,
      carbPer100,
      proteinPer100,
      fatPer100,
      nName,
      nAll: nName + normalize(tag),
    }
  })
}

// 업체 메뉴보다 일반적인 음식이 먼저 나오게 한다.
const TAG_PRIORITY: Record<string, number> = { 가정식: 0, 원재료: 0, 외식: 1, 급식: 2 }
const tagPriority = (tag: string) => TAG_PRIORITY[tag] ?? 3

export interface SearchResult {
  items: IndexedFood[]
  /** limit로 잘리기 전의 전체 일치 건수. */
  total: number
}

/**
 * 띄어 쓴 단어가 모두 들어 있는 항목을 찾는다.
 * 이름이 검색어와 같은 것, 검색어로 시작하는 것, 포함하는 것 순으로 정렬한다.
 */
export function searchFoods(index: IndexedFood[], query: string, limit = 40): SearchResult {
  const tokens = query.split(/\s+/).map(normalize).filter(Boolean)
  if (tokens.length === 0) return { items: [], total: 0 }
  const joined = tokens.join('')

  const hits: { food: IndexedFood; rank: number }[] = []
  for (const food of index) {
    if (!tokens.every((t) => food.nAll.includes(t))) continue
    const rank =
      food.nName === joined ? 0 : food.nName.startsWith(joined) ? 1 : food.nName.includes(joined) ? 2 : 3
    hits.push({ food, rank })
  }
  hits.sort(
    (a, b) =>
      a.rank - b.rank ||
      tagPriority(a.food.tag) - tagPriority(b.food.tag) ||
      a.food.nName.length - b.food.nName.length ||
      a.food.name.localeCompare(b.food.name, 'ko'),
  )
  return { items: hits.slice(0, limit).map((h) => h.food), total: hits.length }
}

/** 먹은 양(g 또는 ml)에 해당하는 칼로리. */
export function kcalFor(food: Pick<Food, 'kcalPer100'>, amount: number): number {
  return Math.round((food.kcalPer100 * amount) / 100)
}

/** 먹은 양에 해당하는 영양소(g). 정보가 없으면 null. */
export function nutrientFor(per100: number | null, amount: number): number | null {
  return per100 === null ? null : Math.round((per100 * amount) / 10) / 10
}
