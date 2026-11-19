import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { addDays, formatKorean, today } from '../lib/date'
import { roughKcal } from '../lib/selectors'
import { useStore } from '../store'
import type { Profile } from '../types'
import { AiError, aiErrorMessage, callAi } from '../ai/client'
import { useAi } from '../ai/store'
import { requestSuggestions, resetSuggest, useSuggest } from '../components/ai/SuggestStore'
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
    expect(screen.getByText('대충 기록 · 보통')).toBeInTheDocument()
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
  const reply = (r: typeof result, used = 1) => ({ result: r, usage: { used, limit: 40 } })
  const toggleName = /남은 양에 맞는 식사 추천/
  const busyText = aiErrorMessage('busy')
  const staleNote = '기록이 바뀌기 전에 받은 추천이라 지금 남은 양과 다를 수 있어요.'
  const limitNote = /오늘 AI 횟수를 다 썼어요/

  function signIn() {
    useAi.setState({ configured: true, checked: true })
    useSync.setState({ email: 'a@b.c', conflict: null })
  }

  /** 펼쳐서 첫 추천을 받는다. */
  async function openAndAsk() {
    fireEvent.click(screen.getByRole('button', { name: toggleName }))
    fireEvent.click(screen.getByRole('button', { name: '추천 받기' }))
    return screen.findByRole('list', { name: '추천 식사' })
  }

  beforeEach(() => {
    mockCall.mockReset()
    mockCall.mockResolvedValue(reply(result))
    resetSuggest()
  })

  afterEach(() => {
    useAi.setState({ configured: false, checked: false, usage: null, usageDate: null, forbidden: false })
    useSync.setState({ email: null, conflict: null })
    resetSuggest()
  })

  it('AI가 꺼져 있으면 추천 버튼도 로그인 안내도 없다', () => {
    renderToday()
    expect(screen.queryByRole('button', { name: toggleName })).not.toBeInTheDocument()
    expect(screen.queryByText(/로그인하면/)).not.toBeInTheDocument()
  })

  it('로그인하지 않았으면 로그인하면 되는 일을 한 줄로 안내한다', () => {
    useAi.setState({ configured: true, checked: true })
    renderToday()
    expect(screen.queryByRole('button', { name: toggleName })).not.toBeInTheDocument()
    expect(screen.getByText(/로그인하면 AI 식사 추천을 받을 수 있어요/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '설정에서 로그인' })).toHaveAttribute('href', '/settings')
  })

  it('기록을 어떻게 할지 정하지 않았으면 추천 대신 정하러 가는 안내를 보여 준다', () => {
    useAi.setState({ configured: true, checked: true })
    useSync.setState({ email: 'a@b.c', conflict: { localCount: 1, remoteCount: 2 } })
    renderToday()
    expect(screen.queryByRole('button', { name: toggleName })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '설정에서 정하기' })).toHaveAttribute('href', '/settings')
  })

  it('오늘 횟수를 다 썼으면 추천 버튼 없이 안내만 보여 준다', () => {
    signIn()
    useAi.setState({ usage: { used: 40, limit: 40 }, usageDate: today() })
    renderToday()
    expect(screen.queryByRole('button', { name: toggleName })).not.toBeInTheDocument()
    expect(screen.getByText(/오늘 AI 횟수를 다 썼어요/)).toBeInTheDocument()
    expect(mockCall).not.toHaveBeenCalled()
  })

  it('접혀 있을 때도 버튼이 가리키는 영역이 문서에 있고, 감춰져 있다', () => {
    signIn()
    renderToday()
    const toggle = screen.getByRole('button', { name: toggleName })
    const region = document.getElementById(toggle.getAttribute('aria-controls')!)
    expect(region).not.toBeNull()
    expect(region).not.toBeVisible()
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(region).toBeVisible()
    expect(screen.getByText('기본 정보와 최근 2주의 체중·식사 기록, 지금 계획을 AI에 보내요.')).toBeInTheDocument()
    expect(screen.getByLabelText('바라는 점 (안 적어도 돼요)')).toHaveAttribute('placeholder', '예: 편의점, 따뜻한 것')
  })

  it('펼쳐서 요청하기 전에는 호출하지 않고, 추천을 누르면 AI 식사로 기록한다', async () => {
    signIn()
    renderToday()
    const toggle = screen.getByRole('button', { name: toggleName })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(mockCall).not.toHaveBeenCalled()

    // 바라는 점은 비워 둔 채 바로 요청할 수 있다. 이 화면의 주 버튼은 '식사 추가'이므로 추천 버튼은 보통 버튼이다.
    const submit = screen.getByRole('button', { name: '추천 받기' })
    expect(submit).not.toHaveClass('btn--primary')
    fireEvent.click(submit)
    const list = await screen.findByRole('list', { name: '추천 식사' })
    expect(mockCall).toHaveBeenCalledTimes(1)
    const request = mockCall.mock.calls[0][0]
    expect(request).toMatchObject({ task: 'suggest', context: { today: today(), todayKcal: 0 } })
    expect(request).not.toHaveProperty('wish')
    expect(request).not.toHaveProperty('avoid')

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
    // 누른 버튼은 '기록함'으로 바뀌어도 초점을 받을 수 있다(disabled가 아니라 aria-disabled).
    const done = await within(list).findByRole('button', { name: '김치찌개와 밥 반 공기 480 kcal 기록함' })
    expect(done).toHaveAttribute('aria-disabled', 'true')
    expect(done).toBeEnabled()
    expect(within(list).getByRole('button', { name: '닭가슴살 샐러드 350 kcal 기록' })).toHaveAttribute('aria-disabled', 'false')
    // 추천을 눌러 기록한 것은 예상한 변화라, 남은 추천을 '바뀌기 전'이라고 하지 않는다.
    expect(screen.queryByText(staleNote)).not.toBeInTheDocument()
    expect(list).not.toHaveClass('is-stale')
    // AI의 한마디는 요청할 때의 남은 양을 말하므로, 하나라도 기록한 뒤에는 보여 주지 않는다.
    expect(screen.queryByText('남은 양은 어림잡은 값이에요.')).not.toBeInTheDocument()

    // '기록함'을 또 눌러도 한 번 더 기록하지 않는다.
    fireEvent.click(done)
    await act(async () => {})
    expect(useStore.getState().meals).toHaveLength(1)
  })

  it('기록한 추천의 식사를 지우면 다시 기록할 수 있고, AI의 한마디도 돌아온다', async () => {
    signIn()
    renderToday()
    const list = await openAndAsk()
    fireEvent.click(within(list).getByRole('button', { name: '닭가슴살 샐러드 350 kcal 기록' }))
    await within(list).findByRole('button', { name: '닭가슴살 샐러드 350 kcal 기록함' })

    // 식사 기록 목록에서 그 식사를 지운다.
    fireEvent.click(screen.getByRole('button', { name: '닭가슴살 샐러드 350 kcal 삭제' }))
    const again = await within(list).findByRole('button', { name: '닭가슴살 샐러드 350 kcal 기록' })
    expect(again).toHaveAttribute('aria-disabled', 'false')
    expect(useStore.getState().meals).toHaveLength(0)
    // 요청할 때와 같은 상태로 돌아왔으니 바뀌기 전의 추천이 아니고, 한마디도 다시 맞는 말이다.
    expect(list).not.toHaveClass('is-stale')
    expect(screen.queryByText(staleNote)).not.toBeInTheDocument()
    expect(screen.getByText('남은 양은 어림잡은 값이에요.')).toBeInTheDocument()

    fireEvent.click(again)
    await within(list).findByRole('button', { name: '닭가슴살 샐러드 350 kcal 기록함' })
    expect(useStore.getState().meals).toHaveLength(1)
    expect(mockCall).toHaveBeenCalledTimes(1)
  })

  it('기다리는 말은 늘 그려 둔 자리 하나에서 알리고, 답이 오면 첫 추천으로 초점을 옮긴다', async () => {
    signIn()
    let release: (v: ReturnType<typeof reply>) => void = () => {}
    mockCall.mockReset()
    mockCall.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
    renderToday()
    fireEvent.click(screen.getByRole('button', { name: toggleName }))
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()

    const submit = screen.getByRole('button', { name: '추천 받기' })
    submit.focus()
    fireEvent.click(submit)
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(status).toHaveTextContent('남은 양에 맞는 식사를 찾는 중이에요')
    // 기다리는 동안에도 누른 버튼은 초점을 잃지 않고, 또 눌러도 한 번만 호출한다.
    expect(submit).toHaveAttribute('aria-disabled', 'true')
    expect(submit).toBeEnabled()
    expect(submit).toHaveFocus()
    fireEvent.click(submit)
    expect(mockCall).toHaveBeenCalledTimes(1)

    await act(async () => {
      release(reply(result))
    })
    const list = screen.getByRole('list', { name: '추천 식사' })
    expect(status).toBeEmptyDOMElement()
    expect(status).not.toContainElement(list)
    expect(within(list).getByText('닭가슴살 샐러드')).toHaveFocus()
  })

  it('맞는 추천이 없이 답이 오면 안내 문장으로 초점을 옮긴다', async () => {
    signIn()
    mockCall.mockReset()
    mockCall.mockResolvedValueOnce(reply({ suggestions: [], note: '남은 양이 아주 적어요.' }))
    renderToday()
    fireEvent.click(screen.getByRole('button', { name: toggleName }))
    fireEvent.click(screen.getByRole('button', { name: '추천 받기' }))
    await waitFor(() => expect(screen.getByText('남은 양이 아주 적어요.')).toHaveFocus())
  })

  it('기다리는 동안 다른 곳을 쓰고 있었으면 초점을 빼앗지 않는다', async () => {
    signIn()
    renderToday()
    fireEvent.click(screen.getByRole('button', { name: toggleName }))
    fireEvent.click(screen.getByRole('button', { name: '추천 받기' }))
    const elsewhere = screen.getByRole('button', { name: '식사 추가' })
    elsewhere.focus()
    await screen.findByRole('list', { name: '추천 식사' })
    expect(elsewhere).toHaveFocus()
  })

  it('자정을 넘겨 어제의 요청이 아직 기다리는 중이어도 오늘의 요청은 바로 보내고, 어제 답은 버린다', async () => {
    signIn()
    let releaseOld: (v: ReturnType<typeof reply>) => void = () => {}
    mockCall.mockReset()
    mockCall
      .mockImplementationOnce(() => new Promise((resolve) => (releaseOld = resolve)))
      .mockResolvedValueOnce(reply({ suggestions: [{ name: '두부 덮밥', kcal: 420, why: '든든해요.' }], note: '' }))
    const yesterday = addDays(today(), -1)
    const context = { today: yesterday, todayKcal: 0 } as Parameters<typeof requestSuggestions>[1]
    void requestSuggestions(yesterday, context)
    expect(useSuggest.getState()).toMatchObject({ date: yesterday, pending: true })

    renderToday()
    fireEvent.click(screen.getByRole('button', { name: toggleName }))
    // 오늘 화면에서는 기다리는 중으로 보이지 않고, 누르면 바로 요청한다.
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    const submit = screen.getByRole('button', { name: '추천 받기' })
    expect(submit).toHaveAttribute('aria-disabled', 'false')
    fireEvent.click(submit)
    expect(mockCall).toHaveBeenCalledTimes(2)
    expect(await screen.findByText('두부 덮밥')).toBeInTheDocument()

    await act(async () => {
      releaseOld(reply(result))
    })
    expect(useSuggest.getState()).toMatchObject({ date: today(), pending: false })
    expect(useSuggest.getState().rows).toHaveLength(1)
    expect(screen.queryByText('닭가슴살 샐러드')).not.toBeInTheDocument()
  })

  it('기록을 빠르게 두 번 눌러도 한 번만 기록한다', async () => {
    signIn()
    renderToday()
    const list = await openAndAsk()
    const log = within(list).getByRole('button', { name: '닭가슴살 샐러드 350 kcal 기록' })
    fireEvent.click(log)
    fireEvent.click(log)
    await within(list).findByRole('button', { name: '닭가슴살 샐러드 350 kcal 기록함' })
    expect(useStore.getState().meals).toHaveLength(1)
  })

  it('다른 추천은 오늘 이미 본 이름들을 avoid로 보내고, 바라는 점에는 덧붙이지 않는다', async () => {
    signIn()
    mockCall
      .mockResolvedValueOnce(reply(result))
      .mockResolvedValueOnce(reply({ suggestions: [{ name: '두부 덮밥', kcal: 420, why: '든든해요.' }], note: '' }))
    renderToday()
    fireEvent.click(screen.getByRole('button', { name: toggleName }))
    fireEvent.change(screen.getByLabelText(/바라는 점/), { target: { value: '편의점에서' } })
    fireEvent.click(screen.getByRole('button', { name: '추천 받기' }))
    await screen.findByRole('list', { name: '추천 식사' })
    expect(mockCall.mock.calls[0][0]).toMatchObject({ task: 'suggest', wish: '편의점에서' })

    fireEvent.click(screen.getByRole('button', { name: '다른 추천 받기' }))
    await screen.findByText('두부 덮밥')
    expect(mockCall.mock.calls[1][0]).toMatchObject({
      task: 'suggest',
      wish: '편의점에서',
      avoid: ['닭가슴살 샐러드', '김치찌개와 밥 반 공기', '그릭요거트'],
    })

    // 세 번째에는 앞의 두 번에서 본 이름이 모두 쌓여 간다.
    fireEvent.click(screen.getByRole('button', { name: '다른 추천 받기' }))
    await waitFor(() => expect(mockCall).toHaveBeenCalledTimes(3))
    expect(mockCall.mock.calls[2][0]).toMatchObject({
      avoid: ['닭가슴살 샐러드', '김치찌개와 밥 반 공기', '그릭요거트', '두부 덮밥'],
    })
  })

  it('피할 이름은 새것부터 12개까지만 보낸다', async () => {
    signIn()
    const round = (n: number) =>
      reply({
        suggestions: [0, 1, 2].map((i) => ({ name: `음식 ${n}-${i}`, kcal: 300, why: '이유' })),
        note: '',
      })
    mockCall.mockReset()
    for (let n = 0; n < 6; n++) mockCall.mockResolvedValueOnce(round(n))
    renderToday()
    await openAndAsk()
    for (let n = 1; n < 6; n++) {
      fireEvent.click(screen.getByRole('button', { name: '다른 추천 받기' }))
      await screen.findByText(`음식 ${n}-0`)
    }
    const avoid = (mockCall.mock.calls[5][0] as { avoid: string[] }).avoid
    expect(avoid).toHaveLength(12)
    expect(avoid[0]).toBe('음식 1-0')
    expect(avoid[11]).toBe('음식 4-2')
  })

  it('추천을 받은 뒤 다른 기록이 바뀌면 다시 부르지 않고, 바뀌기 전의 추천이라고 알린다', async () => {
    signIn()
    renderToday()
    const list = await openAndAsk()
    await useStore.getState().addMeal({ date: today(), kcal: 200, name: '간식', source: 'exact' })
    expect(await screen.findByText(staleNote)).toBeInTheDocument()
    expect(list).toHaveClass('is-stale')
    // 흐려져도 기록 버튼은 그대로 누를 수 있다.
    expect(within(list).getByRole('button', { name: '닭가슴살 샐러드 350 kcal 기록' })).toHaveAttribute('aria-disabled', 'false')
    expect(mockCall).toHaveBeenCalledTimes(1)
  })

  it('오늘 화면을 나갔다 돌아와도 받아 둔 추천이 남아 있다', async () => {
    signIn()
    const { unmount } = renderToday()
    await openAndAsk()
    unmount()

    renderToday()
    expect(screen.getByRole('button', { name: toggleName })).toHaveAttribute('aria-expanded', 'true')
    expect(within(screen.getByRole('list', { name: '추천 식사' })).getAllByRole('listitem')).toHaveLength(3)
    expect(mockCall).toHaveBeenCalledTimes(1)
  })

  it('답을 기다리다 화면을 나가도 요청은 이어지고, 돌아오면 결과가 있다', async () => {
    signIn()
    let release: (v: ReturnType<typeof reply>) => void = () => {}
    mockCall.mockReset()
    mockCall.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
    const { unmount } = renderToday()
    fireEvent.click(screen.getByRole('button', { name: toggleName }))
    fireEvent.click(screen.getByRole('button', { name: '추천 받기' }))
    expect(screen.getByRole('status')).toHaveTextContent('남은 양에 맞는 식사를 찾는 중이에요')
    unmount()

    release(reply(result))
    await waitFor(() => expect(useSuggest.getState().rows).toHaveLength(3))
    renderToday()
    expect(screen.getByRole('list', { name: '추천 식사' })).toBeInTheDocument()
    expect(mockCall).toHaveBeenCalledTimes(1)
  })

  it('맞는 추천이 없으면 AI의 설명을, 설명도 없으면 다르게 해 보라는 안내를 보여 준다', async () => {
    signIn()
    mockCall.mockReset()
    mockCall
      .mockResolvedValueOnce(reply({ suggestions: [], note: '' }))
      .mockResolvedValueOnce(reply({ suggestions: [], note: '남은 양이 아주 적어요.' }))
    renderToday()
    fireEvent.click(screen.getByRole('button', { name: toggleName }))
    fireEvent.click(screen.getByRole('button', { name: '추천 받기' }))
    expect(
      await screen.findByText('지금은 맞는 추천을 찾지 못했어요. 바라는 점을 바꿔서 다시 해 보세요.'),
    ).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: '추천 식사' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '다른 추천 받기' }))
    expect(await screen.findByText('남은 양이 아주 적어요.')).toBeInTheDocument()
  })

  it('실패하면 다시 시도 버튼 하나만 남기고, 다시 시도하면 추천을 받는다', async () => {
    signIn()
    mockCall.mockReset()
    mockCall.mockRejectedValueOnce(new AiError('busy')).mockResolvedValueOnce(reply(result))
    renderToday()
    fireEvent.click(screen.getByRole('button', { name: toggleName }))
    fireEvent.click(screen.getByRole('button', { name: '추천 받기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(busyText)
    expect(screen.queryByRole('button', { name: '추천 받기' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '다시 시도' }))
    expect(await screen.findByRole('list', { name: '추천 식사' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다른 추천 받기' })).toBeInTheDocument()
  })

  it('횟수를 다 썼다는 실패는 실패로 남기지 않고, 횟수 안내 하나만 보여 준다', async () => {
    signIn()
    mockCall.mockReset()
    mockCall.mockRejectedValueOnce(new AiError('limit', { used: 40, limit: 40 }))
    renderToday()
    fireEvent.click(screen.getByRole('button', { name: toggleName }))
    fireEvent.click(screen.getByRole('button', { name: '추천 받기' }))
    expect(await screen.findByText(limitNote)).toBeInTheDocument()
    expect(screen.getAllByText(limitNote)).toHaveLength(1)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(useSuggest.getState().error).toBeNull()
    expect(screen.queryByRole('button', { name: '추천 받기' })).not.toBeInTheDocument()
  })

  it('실패 안내가 남아 있을 때 횟수를 다 쓰면, 받아 둔 추천과 횟수 안내만 보여 준다', async () => {
    signIn()
    mockCall.mockReset()
    mockCall.mockResolvedValueOnce(reply(result)).mockRejectedValueOnce(new AiError('busy'))
    renderToday()
    await openAndAsk()
    fireEvent.click(screen.getByRole('button', { name: '다른 추천 받기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(busyText)

    // 다른 AI 기능으로 남은 횟수를 다 썼다.
    act(() => useAi.getState().setUsage({ used: 40, limit: 40 }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.queryByText(busyText)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '다시 시도' })).not.toBeInTheDocument()
    expect(screen.getAllByText(limitNote)).toHaveLength(1)
    expect(screen.getByRole('list', { name: '추천 식사' })).toBeInTheDocument()
  })

  it('남은 횟수가 적으면 버튼 가까이에 알려 준다', async () => {
    signIn()
    mockCall.mockReset()
    mockCall.mockResolvedValue(reply(result, 35))
    renderToday()
    await openAndAsk()
    const form = screen.getByRole('button', { name: '다른 추천 받기' }).closest('form')!
    expect(within(form).getByText(/5번/)).toBeInTheDocument()
  })

  it('오늘 이미 범위를 넘었으면 추천을 권하지 않는다', async () => {
    await useStore.getState().addMeal({ date: today(), kcal: target() + 320, source: 'exact' })
    signIn()
    const { unmount } = renderToday()
    expect(screen.queryByRole('button', { name: toggleName })).not.toBeInTheDocument()
    unmount()

    // 로그인 전이어도 마찬가지로 안내를 보여 주지 않는다.
    useSync.setState({ email: null, conflict: null })
    renderToday()
    expect(screen.queryByText(/로그인하면 AI 식사 추천/)).not.toBeInTheDocument()
  })

  it('로그아웃하거나 계정이 바뀌면 받아 둔 추천을 지운다', async () => {
    signIn()
    renderToday()
    await openAndAsk()
    useSync.setState({ email: 'other@b.c' })
    await waitFor(() => expect(screen.queryByRole('list', { name: '추천 식사' })).not.toBeInTheDocument())
    expect(useSuggest.getState().rows).toBeNull()
    expect(useSuggest.getState().avoid).toEqual([])
  })

  it('지난 날을 볼 때는 추천을 보여 주지 않는다', () => {
    signIn()
    renderToday()
    expect(screen.getByRole('button', { name: toggleName })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이전 날' }))
    expect(screen.queryByRole('button', { name: toggleName })).not.toBeInTheDocument()
  })
})
