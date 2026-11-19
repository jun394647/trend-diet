import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { addDays, today } from '../lib/date'
import { loadFoodDb } from '../lib/foodDb'
import type { FoodDbFile } from '../lib/foodSearch'
import { roughKcal } from '../lib/selectors'
import { useStore } from '../store'
import type { Profile } from '../types'
import MealSheet from './MealSheet'

// 음식 목록은 한 번 받으면 남는다. 불러오지 못한 경우를 볼 때만 한 번 실패하게 한다.
vi.mock('../lib/foodDb', async (original) => {
  const real = await original<typeof import('../lib/foodDb')>()
  return { ...real, loadFoodDb: vi.fn(real.loadFoodDb) }
})

const file: FoodDbFile = {
  source: '테스트',
  updated: '2026-09-29',
  items: [
    ['김치찌개', '외식', 61, 400, 'g', 3, 3.8, 3.8],
    ['바나나 생것', '원재료', 77, null, 'g', 20, 1.1, 0.1],
    ['카페 라떼', '어느카페', 44, 591, 'ml', 4, 1.9, 2],
  ],
}

const profile: Profile = {
  heightCm: 175,
  birthYear: 1995,
  sex: 'M',
  activityFactor: 1.375,
  startWeightKg: 80,
  goalWeightKg: 72,
  weeklyLossKg: 0.5,
  createdAt: '2026-01-01T00:00:00.000Z',
}

let onClose: ReturnType<typeof vi.fn<() => void>>
const open = () => render(<MealSheet date={today()} targetKcal={2000} onClose={onClose} />)
const type = (value: string) =>
  fireEvent.change(screen.getByLabelText('음식 이름이나 칼로리'), { target: { value } })
const meals = () => useStore.getState().meals

beforeEach(async () => {
  onClose = vi.fn<() => void>()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => file })))
  await useStore.getState().resetAll()
  await useStore.getState().completeOnboarding(profile)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('한 칸 입력', () => {
  it('숫자만 적고 기록하면 그 칼로리로 기록된다', async () => {
    open()
    expect(screen.getByLabelText('음식 이름이나 칼로리')).toHaveFocus()
    type('550')
    fireEvent.click(screen.getByRole('button', { name: '550 kcal 기록하기' }))
    await waitFor(() => expect(meals()).toHaveLength(1))
    expect(meals()[0]).toMatchObject({ kcal: 550, source: 'exact' })
    expect(meals()[0].name).toBeUndefined()
    expect(onClose).toHaveBeenCalled()
  })

  it('이름 뒤에 숫자를 붙이면 이름과 함께 기록된다', async () => {
    open()
    type('김치찌개 550')
    fireEvent.submit(screen.getByTestId('entry-submit').closest('form')!)
    await waitFor(() => expect(meals()).toHaveLength(1))
    expect(meals()[0]).toMatchObject({ name: '김치찌개', kcal: 550 })
  })

  it('범위를 벗어난 숫자는 기록할 수 없고 이유를 알려 준다', () => {
    open()
    type('99999')
    expect(screen.getByRole('alert')).toHaveTextContent('1~5,000 kcal')
    expect(screen.queryByTestId('entry-submit')).not.toBeInTheDocument()
  })

  it('이름만 적으면 기록 버튼 대신 찾은 결과를 보여 준다', async () => {
    open()
    type('김치')
    expect(screen.queryByTestId('entry-submit')).not.toBeInTheDocument()
    const results = await screen.findByRole('list', { name: '검색 결과' })
    expect(within(results).getByRole('button', { name: /김치찌개/ })).toBeInTheDocument()
  })
})

describe('전에 먹은 것', () => {
  it('한 번 기록한 음식은 따로 저장하지 않아도 자주 먹는 것에 뜨고, 한 번 눌러 다시 기록한다', async () => {
    await useStore.getState().addMeal({ date: addDays(today(), -3), kcal: 380, name: '닭가슴살 샐러드', source: 'exact' })
    open()
    expect(screen.getByRole('heading', { name: '자주 먹는 것' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '닭가슴살 샐러드 380 kcal 기록' }))
    await waitFor(() => expect(meals()).toHaveLength(2))
    expect(meals()[1]).toMatchObject({ date: today(), name: '닭가슴살 샐러드', kcal: 380, source: 'favorite' })
  })

  it('이름을 적으면 전에 먹은 것이 음식 목록보다 먼저 나온다', async () => {
    await useStore.getState().addMeal({ date: addDays(today(), -3), kcal: 480, name: '집 김치찌개', source: 'exact' })
    open()
    type('김치')
    expect(screen.getByRole('heading', { name: '전에 먹은 것' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '집 김치찌개 480 kcal 기록' })).toBeInTheDocument()
    await screen.findByRole('list', { name: '검색 결과' })
  })

  it('저장만 해 두고 먹은 기록이 없는 항목은 지울 수 있다', async () => {
    await useStore.getState().addFavorite('바나나', 90)
    open()
    fireEvent.click(screen.getByRole('button', { name: '바나나 목록에서 지우기' }))
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(useStore.getState().favorites).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '바나나 목록에서 지우기' }))
    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(useStore.getState().favorites).toHaveLength(0))
  })

  it('전날 먹은 것을 한 번에 그대로 기록한다', async () => {
    const y = addDays(today(), -1)
    await useStore.getState().addMeal({ date: y, kcal: 600, name: '점심', source: 'exact' })
    await useStore.getState().addMeal({ date: y, kcal: 700, name: '저녁', source: 'exact' })
    open()
    fireEvent.click(screen.getByRole('button', { name: /전날 먹은 2건 그대로 기록 · 1,300 kcal/ }))
    await waitFor(() => expect(meals().filter((m) => m.date === today())).toHaveLength(2))
    expect(meals().filter((m) => m.date === today()).map((m) => m.name)).toEqual(['점심', '저녁'])
  })

  it('오늘 이미 기록이 있으면 전날 그대로 기록을 권하지 않는다', async () => {
    await useStore.getState().addMeal({ date: addDays(today(), -1), kcal: 600, name: '점심', source: 'exact' })
    await useStore.getState().addMeal({ date: today(), kcal: 300, name: '아침', source: 'exact' })
    open()
    expect(screen.queryByRole('button', { name: /전날 먹은/ })).not.toBeInTheDocument()
  })
})

describe('음식 목록에서 찾기', () => {
  it('고르면 1회 제공량 기준으로 기록된다', async () => {
    open()
    type('김치')
    fireEvent.click(await screen.findByRole('button', { name: /김치찌개/ }))
    expect(screen.getByLabelText('먹은 양 (g)')).toHaveValue('400')
    expect(screen.getByTestId('food-kcal')).toHaveTextContent('244 kcal')
    fireEvent.click(screen.getByRole('button', { name: '기록하기' }))
    await waitFor(() => expect(meals()).toHaveLength(1))
    expect(meals()[0]).toMatchObject({ name: '김치찌개', kcal: 244, source: 'search' })
  })

  it('양을 바꾸면 칼로리가 따라 바뀐다', async () => {
    open()
    type('라떼')
    fireEvent.click(await screen.findByRole('button', { name: /카페 라떼/ }))
    fireEvent.click(screen.getByRole('button', { name: '반' }))
    expect(screen.getByLabelText('먹은 양 (ml)')).toHaveValue('295.5')
    expect(screen.getByTestId('food-kcal')).toHaveTextContent('130 kcal')
    fireEvent.change(screen.getByLabelText('먹은 양 (ml)'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: '기록하기' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(meals()).toHaveLength(0)
  })

  it('다른 음식 찾기를 누르면 적어 둔 검색어로 돌아간다', async () => {
    open()
    type('바나나')
    fireEvent.click(await screen.findByRole('button', { name: /바나나 생것/ }))
    expect(screen.getByLabelText('먹은 양 (g)')).toHaveValue('100')
    fireEvent.click(screen.getByRole('button', { name: '다른 음식 찾기' }))
    expect(screen.getByLabelText('음식 이름이나 칼로리')).toHaveValue('바나나')
  })

  it('맞는 음식이 없으면 짧게 알리고, 막다른 화면이 되지 않게 대충 기록을 함께 보여 준다', async () => {
    open()
    type('없는음식')
    // 찾아보기 전에는 대충 기록을 보여 주지 않는다.
    expect(screen.queryByRole('button', { name: /^보통/ })).not.toBeInTheDocument()
    expect(await screen.findByText("'없는음식'에 맞는 음식이 없어요. 포장 가공식품은 들어 있지 않아요.")).toBeInTheDocument()
    // 숫자를 붙이라는 말은 입력 칸 아래 안내에서 한 번만 한다.
    expect(screen.getAllByText(/숫자를 붙여/)).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /^보통/ }))
    await waitFor(() => expect(meals()).toHaveLength(1))
    expect(meals()[0]).toMatchObject({ name: '대충 기록 · 보통', source: 'rough' })
  })

  it('음식 목록을 불러오지 못하면 없다고 하지 않고 다시 불러오게 한다', async () => {
    vi.mocked(loadFoodDb).mockRejectedValueOnce(new Error('offline'))
    open()
    type('아무음식')
    expect(await screen.findByText(/음식 목록을 불러오지 못했어요/)).toBeInTheDocument()
    expect(screen.queryByText(/맞는 음식이 없어요/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    expect(await screen.findByText(/맞는 음식이 없어요/)).toBeInTheDocument()
  })
})

describe('대충 기록과 닫기', () => {
  it('대충 기록은 하루 목표의 비율로 기록한다', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: /^보통/ }))
    await waitFor(() => expect(meals()).toHaveLength(1))
    expect(meals()[0]).toMatchObject({ kcal: roughKcal('medium', 2000), name: '대충 기록 · 보통', source: 'rough' })
  })

  it('AI를 쓸 수 없을 때의 예시는 좁은 화면에 들어가는 길이다', () => {
    open()
    expect(screen.getByLabelText('음식 이름이나 칼로리')).toHaveAttribute('placeholder', '예: 550 · 김치찌개 550')
  })

  it('Tab과 Shift+Tab은 시트 안에서만 돈다', () => {
    render(
      <>
        <button type="button">뒤의 화면</button>
        <MealSheet date={today()} targetKcal={2000} onClose={onClose} />
      </>,
    )
    const dialog = screen.getByRole('dialog', { name: '식사 추가' })
    const buttons = within(dialog).getAllByRole('button')
    const first = screen.getByRole('button', { name: '닫기' })
    const last = buttons[buttons.length - 1]
    expect(buttons[0]).toBe(first)

    last.focus()
    const tab = fireEvent.keyDown(document, { key: 'Tab' })
    expect(tab).toBe(false)
    expect(first).toHaveFocus()

    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()

    // 가운데에서는 브라우저가 하던 대로 둔다.
    screen.getByLabelText('음식 이름이나 칼로리').focus()
    expect(fireEvent.keyDown(document, { key: 'Tab' })).toBe(true)

    // 포커스가 시트 밖에 있으면 안으로 데려온다.
    screen.getByRole('button', { name: '뒤의 화면' }).focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(first).toHaveFocus()
  })

  it('닫기 버튼, Esc, 바깥 누르기로 닫힌다', () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: '닫기' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    const dialog = screen.getByRole('dialog', { name: '식사 추가' })
    fireEvent.click(dialog.parentElement!)
    expect(onClose).toHaveBeenCalledTimes(3)
    fireEvent.click(dialog)
    expect(onClose).toHaveBeenCalledTimes(3)
  })
})
