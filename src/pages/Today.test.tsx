import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { addDays, formatKorean, today } from '../lib/date'
import { roughKcal } from '../lib/selectors'
import { useStore } from '../store'
import type { Profile } from '../types'
import { callAi } from '../ai/client'
import { useAi } from '../ai/store'
import { useSync } from '../sync/store'
import Today from './Today'

vi.mock('../ai/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai/client')>()),
  callAi: vi.fn(),
}))

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
  it('오늘 날짜, 먹은 양, 목표 범위, 지금 단계를 보여 준다', () => {
    renderToday()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(formatKorean(today()))
    expect(screen.getByTestId('kcal-eaten')).toHaveTextContent('0')
    // 아직 먹지 않았으면 범위까지 남은 양을 알려 준다.
    expect(screen.getByTestId('kcal-status')).toHaveTextContent(`${fmt(target() - 100)}~${fmt(target() + 100)}`)
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('감량')
    expect(screen.getByRole('button', { name: '다음 날' })).toBeDisabled()
  })

  it('시트에서 직접 입력으로 식사를 추가하면 먹은 양이 늘어난다', async () => {
    renderToday()
    fireEvent.click(screen.getByRole('button', { name: '식사 추가' }))
    const dialog = screen.getByRole('dialog', { name: '식사 추가' })
    fireEvent.change(within(dialog).getByLabelText('음식 이름이나 칼로리'), { target: { value: '점심 500' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '점심 · 500 kcal 기록하기' }))

    await waitFor(() => {
      expect(screen.getByTestId('kcal-eaten')).toHaveTextContent('500')
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
    expect(screen.getByText('점심', { selector: '.meal-name' })).toBeInTheDocument()
    expect(screen.getByTestId('kcal-status')).toHaveTextContent(`${fmt(target() - 600)}~${fmt(target() - 400)}`)
  })

  it('대충 입력은 목표 비율만큼의 칼로리를 추가한다', async () => {
    renderToday()
    fireEvent.click(screen.getByRole('button', { name: '식사 추가' }))
    fireEvent.click(screen.getByRole('button', { name: /보통/ }))

    const expected = roughKcal('medium', target())
    await waitFor(() => expect(screen.getByTestId('kcal-eaten')).toHaveTextContent(fmt(expected)))
    expect(screen.getByText('대충 입력 · 보통')).toBeInTheDocument()
  })

  it('자주 먹는 것은 시트를 열지 않고 한 번 눌러 기록한다', async () => {
    await useStore.getState().addFavorite('바나나', 90)
    renderToday()
    fireEvent.click(screen.getByRole('button', { name: '바나나 90 kcal 바로 기록' }))

    await waitFor(() => expect(useStore.getState().meals).toHaveLength(1))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('바나나', { selector: '.meal-name' })).toBeInTheDocument()
    expect(screen.getByTestId('kcal-eaten')).toHaveTextContent('90')
    expect(useStore.getState().favorites[0].useCount).toBe(1)
  })

  it('목표 위아래 100kcal까지는 범위 안으로 본다', async () => {
    await useStore.getState().addMeal({ date: today(), kcal: target() + 80, source: 'exact' })
    renderToday()
    expect(screen.getByTestId('kcal-status')).toHaveTextContent('목표 범위 안이에요.')
  })

  it('범위를 넘으면 넘은 양을 알려 주되 한 주 평균으로 본다고 말한다', async () => {
    await useStore.getState().addMeal({ date: today(), kcal: target() + 320, source: 'exact' })
    renderToday()
    const status = screen.getByTestId('kcal-status')
    expect(status).toHaveTextContent('220 kcal 넘었어요')
    expect(status).toHaveTextContent('한 주 평균으로 봐요')
    expect(screen.getByTestId('week-summary')).toHaveTextContent('조금 많아요')
  })

  it('유지 기간에는 유지 범위라고 부른다', async () => {
    useStore.setState((st) => ({ profile: { ...st.profile!, phase: 'maintain', breakUntil: addDays(today(), 10) } }))
    await useStore.getState().addMeal({ date: today(), kcal: target(), source: 'exact' })
    renderToday()
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('쉬어 가는 유지 기간')
    expect(screen.getByTestId('kcal-status')).toHaveTextContent('유지 범위 안이에요.')
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
    expect(screen.getByText('저녁', { selector: '.meal-name' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '저녁 600 kcal 삭제' }))

    await waitFor(() => expect(screen.queryByText('저녁', { selector: '.meal-name' })).not.toBeInTheDocument())
    expect(screen.getByTestId('kcal-eaten')).toHaveTextContent('0')
  })

  it('이전 날로 옮겨 그날 식사를 기록할 수 있다', async () => {
    const yesterday = addDays(today(), -1)
    renderToday()
    fireEvent.click(screen.getByRole('button', { name: '이전 날' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(formatKorean(yesterday))

    fireEvent.click(screen.getByRole('button', { name: '식사 추가' }))
    fireEvent.change(screen.getByLabelText('음식 이름이나 칼로리'), { target: { value: '300' } })
    fireEvent.click(screen.getByRole('button', { name: '300 kcal 기록하기' }))
    await waitFor(() => expect(useStore.getState().meals).toHaveLength(1))
    expect(useStore.getState().meals[0].date).toBe(yesterday)

    fireEvent.click(screen.getByRole('button', { name: '오늘로 돌아가기' }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(formatKorean(today()))
    expect(screen.getByTestId('kcal-eaten')).toHaveTextContent('0')
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

  it('한 주에 기록한 날 수와 평균을 보여 주고, 요일을 누르면 그날로 옮긴다', async () => {
    // 이번 주 월요일에 식사를 기록해 둔다(오늘이 월요일이면 오늘).
    const dow = (new Date().getDay() + 6) % 7
    const monday = addDays(today(), -dow)
    await useStore.getState().addMeal({ date: monday, kcal: target(), source: 'exact' })
    renderToday()
    expect(screen.getByTestId('week-count')).toHaveTextContent(dow === 0 ? '기록 1/7일' : '기록 2/7일')
    expect(screen.getByTestId('week-summary')).toHaveTextContent(`기록한 1일 평균 ${fmt(target())} kcal로 목표 범위 안이에요.`)

    fireEvent.click(screen.getByRole('button', { name: /^월요일/ }))
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(formatKorean(monday))
    expect(screen.getByRole('button', { name: /^월요일/ })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('Today · AI 식사 추천', () => {
  const mockCall = vi.mocked(callAi)
  const result = {
    suggestions: [
      { name: '닭가슴살 샐러드', kcal: 350, why: '남은 양 안에서 단백질을 채울 수 있어요.' },
      { name: '김치찌개와 밥 반 공기', kcal: 480.4, why: '따뜻하고 남은 범위에 들어와요.' },
      { name: '그릭요거트', kcal: 150, why: '가볍게 먹기 좋아요.' },
      { name: '네 번째', kcal: 100, why: '보이지 않아야 해요.' },
    ],
    note: '남은 양은 어림잡은 값이에요.',
  }

  function signIn() {
    useAi.setState({ configured: true, checked: true })
    useSync.setState({ email: 'a@b.c', conflict: null })
  }

  beforeEach(() => {
    mockCall.mockReset()
    mockCall.mockResolvedValue({ result, usage: { used: 1, limit: 40 } })
  })

  afterEach(() => {
    useAi.setState({ configured: false, checked: false, usage: null })
    useSync.setState({ email: null, conflict: null })
  })

  it('AI가 꺼져 있으면 추천 버튼도 로그인 안내도 없다', () => {
    renderToday()
    expect(screen.queryByRole('button', { name: /남은 양에 맞는 식사 추천/ })).not.toBeInTheDocument()
    expect(screen.queryByText(/로그인하면 쓸 수 있어요/)).not.toBeInTheDocument()
  })

  it('로그인하지 않았으면 한 줄 안내만 보여 준다', () => {
    useAi.setState({ configured: true, checked: true })
    renderToday()
    expect(screen.queryByRole('button', { name: /남은 양에 맞는 식사 추천/ })).not.toBeInTheDocument()
    expect(screen.getByText(/AI 식사 추천 받기는 로그인하면 쓸 수 있어요/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '설정에서 로그인' })).toHaveAttribute('href', '/settings')
  })

  it('펼쳐서 요청하기 전에는 호출하지 않고, 추천을 누르면 AI 식사로 기록한다', async () => {
    signIn()
    renderToday()
    const toggle = screen.getByRole('button', { name: /남은 양에 맞는 식사 추천/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(mockCall).not.toHaveBeenCalled()

    // 바라는 점은 비워 둔 채 바로 요청할 수 있다.
    fireEvent.click(screen.getByRole('button', { name: '추천 받기' }))
    const list = await screen.findByRole('list', { name: '추천 식사' })
    expect(mockCall).toHaveBeenCalledTimes(1)
    const request = mockCall.mock.calls[0][0]
    expect(request).toMatchObject({ task: 'suggest', context: { today: today(), todayKcal: 0 } })
    expect(request).not.toHaveProperty('wish')

    expect(within(list).getAllByRole('listitem')).toHaveLength(3)
    expect(within(list).getByText('남은 양 안에서 단백질을 채울 수 있어요.')).toBeInTheDocument()
    expect(screen.getByText('남은 양은 어림잡은 값이에요.')).toBeInTheDocument()

    fireEvent.click(within(list).getByRole('button', { name: '김치찌개와 밥 반 공기 480 kcal 기록' }))
    await waitFor(() => expect(useStore.getState().meals).toHaveLength(1))
    expect(useStore.getState().meals[0]).toMatchObject({
      date: today(),
      name: '김치찌개와 밥 반 공기',
      kcal: 480,
      source: 'ai',
    })
    expect(screen.getByTestId('kcal-eaten')).toHaveTextContent('480')
    expect(await within(list).findByRole('button', { name: '김치찌개와 밥 반 공기 480 kcal 기록함' })).toBeDisabled()
    expect(within(list).getByRole('button', { name: '닭가슴살 샐러드 350 kcal 기록' })).toBeEnabled()
  })

  it('바라는 점을 적으면 함께 보내고, 다른 추천은 방금 본 것을 피해 다시 묻는다', async () => {
    signIn()
    renderToday()
    fireEvent.click(screen.getByRole('button', { name: /남은 양에 맞는 식사 추천/ }))
    fireEvent.change(screen.getByLabelText(/바라는 점/), { target: { value: '편의점에서' } })
    fireEvent.click(screen.getByRole('button', { name: '추천 받기' }))
    await screen.findByRole('list', { name: '추천 식사' })
    expect(mockCall.mock.calls[0][0]).toMatchObject({ task: 'suggest', wish: '편의점에서' })

    fireEvent.click(screen.getByRole('button', { name: '다른 추천' }))
    await waitFor(() => expect(mockCall).toHaveBeenCalledTimes(2))
    const again = mockCall.mock.calls[1][0] as { wish?: string }
    expect(again.wish).toContain('편의점에서')
    expect(again.wish).toContain('닭가슴살 샐러드')
    expect(again.wish!.length).toBeLessThanOrEqual(100)
    await screen.findByRole('list', { name: '추천 식사' })
  })

  it('지난 날을 볼 때는 추천을 보여 주지 않는다', () => {
    signIn()
    renderToday()
    expect(screen.getByRole('button', { name: /남은 양에 맞는 식사 추천/ })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이전 날' }))
    expect(screen.queryByRole('button', { name: /남은 양에 맞는 식사 추천/ })).not.toBeInTheDocument()
  })
})
