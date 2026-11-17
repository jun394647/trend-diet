import { buildIndex, kcalFor, normalize, nutrientFor, searchFoods, type FoodRow } from './foodSearch'

const rows: FoodRow[] = [
  ['김치찌개', '급식', 19, 200, 'ml', 2.3, 1.2, 0.5],
  ['김치찌개', '외식', 61, 400, 'g', 3, 3.8, 3.8],
  ['김치찌개 삼겹살', '외식', 78, 240, 'ml', 3, 3.5, 5.6],
  ['참치 김치찌개', '가정식', 50, 300, 'g', 2, 4, 2],
  ['바나나 생것', '원재료', 77, null, 'g', 20, 1.1, 0.1],
  ['딸기바나나 스무디', '어느카페', 54, 355, 'ml', 11.8, 1.1, 0.7],
  ['커피 카페 라떼 아이스(ICED)', '어느카페', 44, 591, 'g', 4, 1.9, 2],
]
const index = buildIndex(rows)
const names = (q: string) => searchFoods(index, q).items.map((f) => `${f.name}/${f.tag}`)

it('normalize는 공백과 구두점을 없애고 소문자로 만든다', () => {
  expect(normalize('카페 라떼 아이스(ICED)')).toBe('카페라떼아이스iced')
  expect(normalize('과ㆍ채주스_딸기')).toBe('과채주스딸기')
})

describe('searchFoods', () => {
  it('이름이 같은 것, 시작하는 것, 포함하는 것 순으로 나온다', () => {
    expect(names('김치찌개')).toEqual([
      '김치찌개/외식',
      '김치찌개/급식',
      '김치찌개 삼겹살/외식',
      '참치 김치찌개/가정식',
    ])
  })

  it('업체 메뉴보다 일반 식품이 먼저 나온다', () => {
    expect(names('바나나')).toEqual(['바나나 생것/원재료', '딸기바나나 스무디/어느카페'])
  })

  it('띄어 쓴 단어가 모두 들어 있어야 한다', () => {
    expect(names('삼겹살 김치')).toEqual(['김치찌개 삼겹살/외식'])
    expect(names('김치 피자')).toEqual([])
  })

  it('띄어쓰기와 대소문자가 달라도 찾는다', () => {
    expect(names('카페라떼 iced')).toEqual(['커피 카페 라떼 아이스(ICED)/어느카페'])
  })

  it('업체명으로도 찾는다', () => {
    expect(names('어느카페 스무디')).toEqual(['딸기바나나 스무디/어느카페'])
  })

  it('빈 검색어는 결과가 없다', () => {
    expect(searchFoods(index, '   ')).toEqual({ items: [], total: 0 })
  })

  it('limit로 자르되 전체 건수는 알려 준다', () => {
    const r = searchFoods(index, '김치', 2)
    expect(r.items).toHaveLength(2)
    expect(r.total).toBe(4)
  })
})

it('먹은 양에 맞춰 칼로리와 영양소를 계산한다', () => {
  expect(kcalFor({ kcalPer100: 61 }, 400)).toBe(244)
  expect(kcalFor({ kcalPer100: 77 }, 120)).toBe(92)
  expect(nutrientFor(3.8, 400)).toBe(15.2)
  expect(nutrientFor(null, 400)).toBeNull()
})
