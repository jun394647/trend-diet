import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { FoodDbFile } from '../lib/foodSearch'
import { today } from '../lib/date'
import { useStore } from '../store'
import type { Profile } from '../types'
import MealSheet from './MealSheet'

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

beforeEach(async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => file })),
  )
  await useStore.getState().resetAll()
  await useStore.getState().completeOnboarding(profile)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

async function openSearch() {
  render(<MealSheet date={today()} targetKcal={2000} onClose={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: '검색' }))
  await screen.findByText(/음식 3가지에서 찾아요/)
}

describe('음식 검색', () => {
  it('검색해서 고르면 1회 제공량 기준 칼로리로 기록된다', async () => {
    await openSearch()
    fireEvent.change(screen.getByLabelText('음식 이름'), { target: { value: '김치' } })
    const results = await screen.findByRole('list', { name: '검색 결과' })
    fireEvent.click(within(results).getByRole('button', { name: /김치찌개/ }))

    expect(screen.getByLabelText('먹은 양 (g)')).toHaveValue('400')
    expect(screen.getByTestId('food-kcal')).toHaveTextContent('244 kcal')

    fireEvent.click(screen.getByRole('button', { name: '기록하기' }))
    await waitFor(() => expect(useStore.getState().meals).toHaveLength(1))
    expect(useStore.getState().meals[0]).toMatchObject({ name: '김치찌개', kcal: 244, source: 'search' })
  })

  it('양을 바꾸면 칼로리가 따라 바뀌고, 즐겨찾기에도 저장할 수 있다', async () => {
    await openSearch()
    fireEvent.change(screen.getByLabelText('음식 이름'), { target: { value: '라떼' } })
    fireEvent.click(await screen.findByRole('button', { name: /카페 라떼/ }))

    fireEvent.click(screen.getByRole('button', { name: '반' }))
    expect(screen.getByLabelText('먹은 양 (ml)')).toHaveValue('295.5')
    expect(screen.getByTestId('food-kcal')).toHaveTextContent('130 kcal')

    fireEvent.click(screen.getByRole('checkbox', { name: /즐겨찾기에 저장/ }))
    fireEvent.click(screen.getByRole('button', { name: '기록하기' }))
    await waitFor(() => expect(useStore.getState().favorites).toHaveLength(1))
    expect(useStore.getState().favorites[0]).toMatchObject({ name: '카페 라떼 (어느카페)', kcal: 130 })
    expect(useStore.getState().meals[0].kcal).toBe(130)
  })

  it('1회 제공량 정보가 없으면 100g으로 시작한다', async () => {
    await openSearch()
    fireEvent.change(screen.getByLabelText('음식 이름'), { target: { value: '바나나' } })
    fireEvent.click(await screen.findByRole('button', { name: /바나나 생것/ }))
    expect(screen.getByLabelText('먹은 양 (g)')).toHaveValue('100')
    fireEvent.change(screen.getByLabelText('먹은 양 (g)'), { target: { value: '120' } })
    expect(screen.getByTestId('food-kcal')).toHaveTextContent('92 kcal')
  })

  it('잘못된 양은 기록하지 않는다', async () => {
    await openSearch()
    fireEvent.change(screen.getByLabelText('음식 이름'), { target: { value: '김치' } })
    fireEvent.click(await screen.findByRole('button', { name: /김치찌개/ }))
    fireEvent.change(screen.getByLabelText('먹은 양 (g)'), { target: { value: 'abc' } })
    fireEvent.click(screen.getByRole('button', { name: '기록하기' }))
    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(useStore.getState().meals).toHaveLength(0)
  })

  it('맞는 음식이 없으면 안내한다', async () => {
    await openSearch()
    fireEvent.change(screen.getByLabelText('음식 이름'), { target: { value: '없는음식' } })
    expect(await screen.findByText(/맞는 음식이 없어요/)).toBeInTheDocument()
  })
})
