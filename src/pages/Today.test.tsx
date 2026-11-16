import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { addDays, formatKorean, today } from '../lib/date'
import { roughKcal } from '../lib/selectors'
import { useStore } from '../store'
import type { Profile } from '../types'
import Today from './Today'

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

const fmt = (n: number) => n.toLocaleString('ko-KR')
const target = () => useStore.getState().checkins[0].targetKcal

function renderToday() {
  return render(
    <MemoryRouter>
      <Today />
    </MemoryRouter>,
  )
}

beforeEach(async () => {
  await useStore.getState().resetAll()
  await useStore.getState().completeOnboarding(profile)
})

describe('Today', () => {
  it('오늘 날짜와 남은 칼로리를 보여 준다', () => {
    renderToday()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(formatKorean(today()))
    expect(screen.getByTestId('kcal-hero')).toHaveTextContent(fmt(target()))
    expect(screen.getByRole('button', { name: '다음 날' })).toBeDisabled()
  })

  it('시트에서 직접 입력으로 식사를 추가하면 남은 칼로리가 줄어든다', async () => {
    renderToday()
    fireEvent.click(screen.getByRole('button', { name: '식사 추가' }))
    const dialog = screen.getByRole('dialog', { name: '식사 추가' })
    fireEvent.change(within(dialog).getByLabelText('칼로리 (kcal)'), { target: { value: '500' } })
    fireEvent.change(within(dialog).getByLabelText('이름 (선택)'), { target: { value: '점심' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '기록하기' }))

    await waitFor(() =>
      expect(screen.getByTestId('kcal-hero')).toHaveTextContent(fmt(target() - 500)),
    )
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('점심')).toBeInTheDocument()
    expect(screen.getByTestId('kcal-eaten')).toHaveTextContent('500')
  })

  it('대충 입력은 목표 비율만큼의 칼로리를 추가한다', async () => {
    renderToday()
    fireEvent.click(screen.getByRole('button', { name: '식사 추가' }))
    fireEvent.click(screen.getByRole('button', { name: '대충 입력' }))
    fireEvent.click(screen.getByRole('button', { name: /보통/ }))

    const expected = roughKcal('medium', target())
    await waitFor(() =>
      expect(screen.getByTestId('kcal-hero')).toHaveTextContent(fmt(target() - expected)),
    )
    expect(screen.getByText('대충 입력 · 보통')).toBeInTheDocument()
  })

  it('즐겨찾기를 한 번 누르면 식사 목록에 추가된다', async () => {
    await useStore.getState().addFavorite('바나나', 90)
    renderToday()
    fireEvent.click(screen.getByRole('button', { name: '식사 추가' }))
    // 즐겨찾기가 있으면 즐겨찾기 탭이 기본이다.
    fireEvent.click(screen.getByRole('button', { name: '바나나 90 kcal 기록' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByText('바나나')).toBeInTheDocument()
    expect(screen.getByTestId('kcal-hero')).toHaveTextContent(fmt(target() - 90))
    expect(useStore.getState().favorites[0].useCount).toBe(1)
  })

  it('목표를 넘으면 넘은 양을 보여 준다', async () => {
    await useStore.getState().addMeal({ date: today(), kcal: target() + 120, source: 'exact' })
    renderToday()
    expect(screen.getByTestId('kcal-hero')).toHaveTextContent('+120')
    expect(screen.getByText('목표를 넘은 양')).toBeInTheDocument()
  })

  it('체중을 저장하면 값과 추세를 보여 준다', async () => {
    await useStore.getState().removeWeight(today())
    renderToday()
    fireEvent.change(screen.getByLabelText('체중 (kg)'), { target: { value: '79,46' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))

    await waitFor(() => expect(screen.getByTestId('weight-value')).toHaveTextContent('79.5'))
    expect(screen.getByTestId('weight-trend')).toHaveTextContent('79.5')
    expect(useStore.getState().weights).toEqual([{ date: today(), kg: 79.5 }])
  })

  it('범위를 벗어난 체중은 저장하지 않는다', async () => {
    await useStore.getState().removeWeight(today())
    renderToday()
    fireEvent.change(screen.getByLabelText('체중 (kg)'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByRole('alert')).toBeInTheDocument()
    expect(useStore.getState().weights).toHaveLength(0)
  })

  it('기록한 체중을 고치거나 지울 수 있다', async () => {
    renderToday()
    expect(screen.getByTestId('weight-value')).toHaveTextContent('80.0')
    fireEvent.click(screen.getByRole('button', { name: '체중 수정' }))
    fireEvent.change(screen.getByLabelText('체중 (kg)'), { target: { value: '79.2' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.getByTestId('weight-value')).toHaveTextContent('79.2'))

    fireEvent.click(screen.getByRole('button', { name: '체중 수정' }))
    fireEvent.click(screen.getByRole('button', { name: '체중 기록 삭제' }))
    await waitFor(() => expect(useStore.getState().weights).toHaveLength(0))
    expect(screen.queryByTestId('weight-value')).not.toBeInTheDocument()
  })

  it('식사를 삭제하면 목록과 합계에서 빠진다', async () => {
    await useStore.getState().addMeal({ date: today(), kcal: 600, name: '저녁', source: 'exact' })
    renderToday()
    expect(screen.getByText('저녁')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '저녁 600 kcal 삭제' }))

    await waitFor(() => expect(screen.queryByText('저녁')).not.toBeInTheDocument())
    expect(screen.getByTestId('kcal-hero')).toHaveTextContent(fmt(target()))
  })

  it('이전 날로 옮겨 그날 식사를 기록할 수 있다', async () => {
    const yesterday = addDays(today(), -1)
    renderToday()
    fireEvent.click(screen.getByRole('button', { name: '이전 날' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(formatKorean(yesterday))

    fireEvent.click(screen.getByRole('button', { name: '식사 추가' }))
    fireEvent.change(screen.getByLabelText('칼로리 (kcal)'), { target: { value: '300' } })
    fireEvent.click(screen.getByRole('button', { name: '기록하기' }))
    await waitFor(() => expect(useStore.getState().meals).toHaveLength(1))
    expect(useStore.getState().meals[0].date).toBe(yesterday)

    fireEvent.click(screen.getByRole('button', { name: '오늘로 돌아가기' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(formatKorean(today()))
    expect(screen.getByTestId('kcal-hero')).toHaveTextContent(fmt(target()))
  })

  it('체크인과 백업 안내는 필요할 때만 보인다', async () => {
    // 온보딩 직후: 체크인은 아직, 백업은 한 번도 안 했으니 안내.
    const { unmount } = renderToday()
    expect(screen.queryByText('주간 체크인을 할 때가 됐어요')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '백업하기' })).toHaveAttribute('href', '/settings')
    unmount()

    const old = addDays(today(), -8)
    useStore.setState((s) => ({
      checkins: s.checkins.map((c) => ({ ...c, date: old })),
      lastBackupAt: new Date().toISOString(),
    }))
    renderToday()
    expect(screen.getByText('주간 체크인을 할 때가 됐어요')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '체크인하기' })).toHaveAttribute('href', '/checkin')
    expect(screen.queryByRole('link', { name: '백업하기' })).not.toBeInTheDocument()

    // 지난 날을 볼 때는 안내를 숨긴다.
    fireEvent.click(screen.getByRole('button', { name: '이전 날' }))
    expect(screen.queryByText('주간 체크인을 할 때가 됐어요')).not.toBeInTheDocument()
  })

  it('이틀 이상 이어서 기록하면 연속 기록을 보여 준다', async () => {
    await useStore.getState().setWeight(addDays(today(), -1), 80.2)
    renderToday()
    expect(screen.getByText(/일 연속 기록 중/)).toHaveTextContent('2일 연속 기록 중')
  })
})
