import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { addDays, today } from '../lib/date'
import { buildInitialCheckin } from '../lib/plan'
import { buildCheckinReview } from '../lib/sustain'
import type { CheckinOption, CheckinOptionId, CheckinReview } from '../lib/sustain'
import { useStore } from '../store'
import type { Checkin as CheckinRecord, MealEntry, Profile, WeightEntry } from '../types'
import { AiError, callAi } from '../ai/client'
import { useAi } from '../ai/store'
import { clearWeekReviewCache, requestWeekReview, useWeekReview } from '../components/ai/WeekReviewCache'
import { useSync } from '../sync/store'
import Checkin from './Checkin'

vi.mock('../ai/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../ai/client')>()),
  callAi: vi.fn(),
}))

const base: Profile = {
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
  await useStore.getState().resetAll()
})

function renderCheckin() {
  return render(
    <MemoryRouter initialEntries={['/checkin']}>
      <Routes>
        <Route path="/checkin" element={<Checkin />} />
        <Route path="/" element={<p>홈 화면</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

const fmt = (n: number) => n.toLocaleString('ko-KR')
const rangeText = (target: number) => `${fmt(target - 100)}~${fmt(target + 100)} kcal`

/**
 * 4주 동안 매일 체중(하루 0.1kg 감소)과 식사(kcal)를 기록한 상태.
 * phaseDaysAgo는 감량 단계를 시작한 지 며칠 됐는지.
 */
function seed(opts: { kcal?: number; phaseDaysAgo?: number } = {}): {
  profile: Profile
  initial: CheckinRecord
  review: CheckinReview
} {
  const days = 28
  const start = addDays(today(), -(days - 1))
  const profile: Profile = { ...base, phase: 'lose', phaseStartedAt: addDays(today(), -(opts.phaseDaysAgo ?? days - 1)) }
  const weights: WeightEntry[] = []
  const meals: MealEntry[] = []
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i)
    weights.push({ date, kg: Math.round((80 - i * 0.1) * 10) / 10 })
    meals.push({ id: `m${i}`, date, kcal: opts.kcal ?? 2000, source: 'exact', createdAt: `${date}T12:00:00.000Z` })
  }
  const initial = buildInitialCheckin(profile, start)
  useStore.setState({ profile, weights, meals, checkins: [initial] })
  const review = buildCheckinReview({ profile, weights, meals, checkins: [initial], asOf: today() })
  if (!review) throw new Error('review should exist')
  return { profile, initial, review }
}

function optionOf(review: CheckinReview, id: CheckinOptionId): CheckinOption {
  const o = review.options.find((x) => x.id === id)
  if (!o) throw new Error(`option ${id} should exist`)
  return o
}

async function savedCheckin(): Promise<CheckinRecord> {
  await waitFor(() => expect(useStore.getState().checkins).toHaveLength(2))
  return useStore.getState().checkins[1]
}

describe('Checkin', () => {
  it('계획이 없으면 홈으로 가는 안내를 보여 준다', () => {
    renderCheckin()
    expect(screen.getByRole('link', { name: '홈으로 가기' })).toHaveAttribute('href', '/')
  })

  it('달라질 게 없으면 선택지 없이 확인 버튼만 보여 준다', async () => {
    const date = addDays(today(), -2)
    const profile: Profile = { ...base, phase: 'lose', phaseStartedAt: date }
    const initial = buildInitialCheckin(profile, date)
    useStore.setState({ profile, weights: [{ date, kg: 80 }], meals: [], checkins: [initial] })
    renderCheckin()

    expect(screen.getByText(/기록이 아직 부족해서 이전 추정치를 그대로 둘게요/)).toBeInTheDocument()
    expect(screen.getByText('지금 0일')).toBeInTheDocument()
    expect(screen.getByText('지금 1회')).toBeInTheDocument()
    expect(screen.getByText(/마지막 체크인이/)).toBeInTheDocument()
    expect(screen.getByTestId('checkin-phase')).toHaveTextContent('감량 1주차')
    expect(screen.getByTestId('checkin-nochange')).toHaveTextContent('달라질 게 없어요')
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '확인' }))
    expect(await savedCheckin()).toMatchObject({
      date: today(),
      kind: 'weekly',
      targetKcal: initial.targetKcal,
      estimatedTdee: initial.estimatedTdee,
    })
    expect(await screen.findByText('홈 화면')).toBeInTheDocument()
  })

  it('권하는 선택지가 먼저 골라져 있고, 확인하면 새 목표로 주간 체크인을 저장한다', async () => {
    const { profile, initial, review } = seed()
    expect(review.options.map((o) => o.id)).toEqual(['adaptive', 'keep'])
    const adaptive = optionOf(review, 'adaptive')
    expect(adaptive.targetKcal).not.toBe(initial.targetKcal)
    renderCheckin()

    expect(screen.getByTestId('checkin-trend')).toHaveTextContent((review.trendKg ?? 0).toFixed(1))
    expect(screen.getByTestId('checkin-recent')).toHaveTextContent('2,000 kcal · 기록 7일')
    expect(screen.getByText(/평균 섭취량과 추세 체중 변화로 계산했어요/)).toBeInTheDocument()

    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(radios[0]).toBeChecked()
    const first = screen.getByTestId('option-adaptive')
    expect(within(first).getByText('추천')).toBeInTheDocument()
    expect(within(screen.getByTestId('option-keep')).queryByText('추천')).not.toBeInTheDocument()
    expect(screen.getByTestId('option-adaptive-range')).toHaveTextContent(rangeText(adaptive.targetKcal))
    expect(screen.getByTestId('option-keep-range')).toHaveTextContent(rangeText(initial.targetKcal))

    fireEvent.click(screen.getByRole('button', { name: '새 목표로 바꾸기' }))

    const saved = await savedCheckin()
    expect(saved).toMatchObject({
      date: today(),
      kind: 'weekly',
      targetKcal: adaptive.targetKcal,
      estimatedTdee: adaptive.estimatedTdee,
    })
    expect(saved.trendKg).not.toBeNull()
    expect(useStore.getState().profile).toEqual(profile)
    expect(await screen.findByText('홈 화면')).toBeInTheDocument()
  })

  it('권하지 않은 선택지(그대로)를 고르면 이전 목표로 저장하고 프로필은 그대로다', async () => {
    const { profile, initial } = seed()
    renderCheckin()

    fireEvent.click(within(screen.getByTestId('option-keep')).getByRole('radio'))
    expect(within(screen.getByTestId('option-keep')).getByRole('radio')).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '이대로 유지하기' }))

    expect(await savedCheckin()).toMatchObject({
      date: today(),
      kind: 'weekly',
      targetKcal: initial.targetKcal,
      estimatedTdee: initial.estimatedTdee,
    })
    expect(useStore.getState().profile).toEqual(profile)
    expect(await screen.findByText('홈 화면')).toBeInTheDocument()
  })

  it('최근 섭취가 목표를 크게 넘으면 속도를 늦추는 선택지를 권하고, 확인하면 속도가 바뀐다', async () => {
    const { initial, review } = seed({ kcal: 2400 })
    expect(review.options[0].id).toBe('slower')
    const slower = optionOf(review, 'slower')
    renderCheckin()

    const row = screen.getByTestId('option-slower')
    expect(within(row).getByRole('radio')).toBeChecked()
    expect(within(row).getByText('추천')).toBeInTheDocument()
    expect(row).toHaveTextContent(`목표보다 ${fmt(2400 - initial.targetKcal)} kcal 많았어요`)
    expect(screen.getByTestId('option-slower-range')).toHaveTextContent(rangeText(slower.targetKcal))

    fireEvent.click(screen.getByRole('button', { name: '주 0.25 kg으로 늦추기' }))

    expect(await savedCheckin()).toMatchObject({ kind: 'weekly', targetKcal: slower.targetKcal })
    expect(useStore.getState().profile?.weeklyLossKg).toBe(0.25)
    expect(useStore.getState().profile?.phase).toBe('lose')
  })

  it('감량이 10주를 넘으면 2주 유지 기간을 권하고, 확인하면 유지 단계로 바뀐다', async () => {
    const { review } = seed({ phaseDaysAgo: 80 })
    expect(review.options[0].id).toBe('break')
    const rest = optionOf(review, 'break')
    renderCheckin()

    expect(screen.getByTestId('checkin-phase')).toHaveTextContent('감량 12주차')
    expect(within(screen.getByTestId('option-break')).getByRole('radio')).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: '2주 유지 기간 시작하기' }))

    expect(await savedCheckin()).toMatchObject({ kind: 'weekly', targetKcal: rest.targetKcal })
    const p = useStore.getState().profile
    expect(p?.phase).toBe('maintain')
    expect(p?.breakUntil).toBe(addDays(today(), 14))
    expect(p?.weeklyLossKg).toBe(0.5)
  })
})

describe('Checkin · AI 돌아보기', () => {
  const mockCall = vi.mocked(callAi)
  const result = {
    headline: '꾸준히 기록한 2주였어요',
    wins: ['14일 모두 식사를 기록했어요', '평균 섭취가 범위 안이었어요'],
    observations: ['주말에 섭취가 조금 늘었어요'],
    nextStep: '토요일 점심을 미리 정해 두기',
  }
  const reply = (used = 1) => ({ result, usage: { used, limit: 40 } })
  const askName = 'AI 돌아보기 받기'
  const intro = '최근 2주 기록을 읽고, 잘된 점과 해 볼 만한 한 가지를 짧게 적어요.'

  function signIn(email = 'a@b.c') {
    useAi.setState({ configured: true, checked: true })
    useSync.setState({ email, conflict: null })
  }

  /** 새로 고침처럼, 기기에 적어 둔 것은 두고 메모리에 있던 것만 잊는다. */
  function forgetInMemory() {
    useWeekReview.setState({ key: null, review: null, pending: false, error: null })
  }

  beforeEach(() => {
    mockCall.mockReset()
    mockCall.mockResolvedValue(reply())
    clearWeekReviewCache()
  })

  afterEach(() => {
    useAi.setState({ configured: false, checked: false, usage: null, usageDate: null, forbidden: false })
    useSync.setState({ email: null, conflict: null })
    clearWeekReviewCache()
  })

  it('AI가 꺼져 있으면 돌아보기 구획이 없다', () => {
    seed()
    renderCheckin()
    expect(screen.queryByRole('heading', { name: 'AI 돌아보기' })).not.toBeInTheDocument()
    expect(screen.queryByText(/로그인하면/)).not.toBeInTheDocument()
  })

  it('로그인하지 않았으면 제목이 있는 구획 안에서 로그인하면 되는 일을 안내한다', () => {
    seed()
    useAi.setState({ configured: true, checked: true })
    renderCheckin()
    expect(screen.queryByRole('button', { name: askName })).not.toBeInTheDocument()
    const hint = screen.getByText(/로그인하면 AI가 지난 2주를 돌아봐 줘요/)
    const section = hint.closest('section')
    expect(section).toHaveClass('card')
    expect(within(section!).getByRole('heading', { name: 'AI 돌아보기' })).toBeInTheDocument()
    expect(within(section!).getByRole('link', { name: '설정에서 로그인' })).toHaveAttribute('href', '/settings')
  })

  it('기록을 어떻게 할지 정하지 않았으면 버튼 대신 정하러 가는 안내를 보여 준다', () => {
    seed()
    useAi.setState({ configured: true, checked: true })
    useSync.setState({ email: 'a@b.c', conflict: { localCount: 1, remoteCount: 2 } })
    renderCheckin()
    expect(screen.getByRole('heading', { name: 'AI 돌아보기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: askName })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '설정에서 정하기' })).toBeInTheDocument()
  })

  it('오늘 횟수를 다 썼으면 버튼 없이 안내만 보여 주고, 선택지는 그대로다', () => {
    seed()
    signIn()
    useAi.setState({ usage: { used: 40, limit: 40 }, usageDate: today() })
    renderCheckin()
    expect(screen.queryByRole('button', { name: askName })).not.toBeInTheDocument()
    expect(screen.getByText(/오늘 AI 횟수를 다 썼어요/)).toBeInTheDocument()
    expect(screen.getByTestId('checkin-confirm')).toBeEnabled()
  })

  it('버튼을 누르기 전에는 호출하지 않고, 누르면 돌아본 내용을 보여 주고 한 줄 요약으로 초점을 옮긴다', async () => {
    const { review } = seed()
    signIn()
    renderCheckin()
    expect(screen.getByRole('heading', { name: 'AI 돌아보기' })).toBeInTheDocument()
    expect(screen.getByText(intro)).toBeInTheDocument()
    expect(mockCall).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: askName }))
    const body = await screen.findByTestId('week-review')
    expect(mockCall).toHaveBeenCalledTimes(1)
    const request = mockCall.mock.calls[0][0] as { recommendation?: string }
    expect(request).toMatchObject({ task: 'week-review', context: { today: today() } })
    // 앱이 권하는(첫 번째) 선택지를 함께 보낸다.
    expect(review.options[0].id).toBe('adaptive')
    expect(request.recommendation).toBe('새 추정치에 맞춰 목표 조정')

    expect(body).toHaveTextContent('꾸준히 기록한 2주였어요')
    expect(within(within(body).getByRole('list', { name: '잘된 점' })).getAllByRole('listitem')).toHaveLength(2)
    expect(within(body).getByRole('list', { name: '눈에 띄는 점' })).toHaveTextContent('주말에 섭취가 조금 늘었어요')
    // 선택지 카드처럼 보이지 않게 상자(.well)는 쓰지 않는다.
    const next = within(body).getByText('해 볼 만한 한 가지').parentElement!
    expect(next).toHaveTextContent('토요일 점심을 미리 정해 두기')
    expect(next).not.toHaveClass('well')
    expect(screen.queryByRole('button', { name: askName })).not.toBeInTheDocument()
    expect(screen.queryByText(intro)).not.toBeInTheDocument()
    await waitFor(() => expect(within(body).getByText('꾸준히 기록한 2주였어요')).toHaveFocus())
    // 돌아보기 구획은 선택지보다 앞에 있다.
    const choice = screen.getByRole('heading', { name: '다음 한 주' })
    expect(body.compareDocumentPosition(choice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('기다리는 동안 안내 문장은 그대로 두고 버튼 자리만 바꾸며, 같은 자리(role=status)에서 결과를 알린다', async () => {
    seed()
    signIn()
    let release: (v: ReturnType<typeof reply>) => void = () => {}
    mockCall.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
    renderCheckin()
    const status = screen.getByRole('status')
    expect(status).toBeEmptyDOMElement()

    fireEvent.click(screen.getByRole('button', { name: askName }))
    expect(screen.getByText(intro)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: askName })).not.toBeInTheDocument()
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(status).toHaveTextContent('최근 2주를 돌아보는 중이에요')

    release(reply())
    const body = await screen.findByTestId('week-review')
    expect(status).toContainElement(body)
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('권하는 선택지에 따라 다른 말을 보낸다', async () => {
    const { review } = seed({ phaseDaysAgo: 80 })
    expect(review.options[0].id).toBe('break')
    signIn()
    renderCheckin()
    fireEvent.click(screen.getByRole('button', { name: askName }))
    await screen.findByTestId('week-review')
    expect(mockCall.mock.calls[0][0]).toMatchObject({ recommendation: '2주 쉬어 가기(유지 기간)' })
  })

  it('같은 날 화면을 나갔다 돌아와도, 새로 고쳐도 다시 호출하지 않는다', async () => {
    seed()
    signIn()
    const first = renderCheckin()
    fireEvent.click(screen.getByRole('button', { name: askName }))
    await screen.findByTestId('week-review')
    first.unmount()

    const second = renderCheckin()
    expect(screen.getByTestId('week-review')).toHaveTextContent('꾸준히 기록한 2주였어요')
    // 돌아와서 다시 볼 때는 초점을 가져가지 않는다.
    expect(screen.getByText('꾸준히 기록한 2주였어요')).not.toHaveFocus()
    second.unmount()

    forgetInMemory()
    renderCheckin()
    expect(screen.getByTestId('week-review')).toHaveTextContent('꾸준히 기록한 2주였어요')
    expect(mockCall).toHaveBeenCalledTimes(1)
  })

  it('앱을 다시 켜서 같은 계정으로 로그인이 복원되면 적어 둔 돌아보기를 그대로 쓴다', async () => {
    seed()
    signIn()
    const first = renderCheckin()
    fireEvent.click(screen.getByRole('button', { name: askName }))
    await screen.findByTestId('week-review')
    first.unmount()

    // 새로 고침: 메모리는 비고, 로그인은 없음에서 같은 계정으로 돌아온다.
    forgetInMemory()
    useSync.setState({ email: null }, false)
    localStorage.setItem('trend-diet:week-review', JSON.stringify({ key: `a@b.c|${today()}`, review: result }))
    useSync.setState({ email: 'a@b.c' })
    renderCheckin()
    expect(screen.getByTestId('week-review')).toBeInTheDocument()
    expect(mockCall).toHaveBeenCalledTimes(1)
  })

  it('로그아웃하거나 다른 계정으로 바뀌면 받아 둔 돌아보기를 보여 주지 않고 기기에서도 지운다', async () => {
    seed()
    signIn()
    renderCheckin()
    fireEvent.click(screen.getByRole('button', { name: askName }))
    await screen.findByTestId('week-review')
    expect(localStorage.getItem('trend-diet:week-review')).toContain('a@b.c')

    useSync.setState({ email: 'other@b.c' })
    await waitFor(() => expect(screen.queryByTestId('week-review')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: askName })).toBeInTheDocument()
    expect(localStorage.getItem('trend-diet:week-review')).toBeNull()
  })

  it('답을 기다리다 화면을 나가도 요청은 이어지고, 돌아오면 결과가 있다', async () => {
    seed()
    signIn()
    let release: (v: ReturnType<typeof reply>) => void = () => {}
    mockCall.mockImplementationOnce(() => new Promise((resolve) => (release = resolve)))
    const { unmount } = renderCheckin()
    fireEvent.click(screen.getByRole('button', { name: askName }))
    unmount()

    release(reply())
    await waitFor(() => expect(useWeekReview.getState().review).not.toBeNull())
    renderCheckin()
    expect(screen.getByTestId('week-review')).toHaveTextContent('꾸준히 기록한 2주였어요')
    expect(mockCall).toHaveBeenCalledTimes(1)
  })

  it('기다리는 중에 다시 요청해도 한 번만 호출한다', async () => {
    const { review } = seed()
    signIn()
    mockCall.mockImplementationOnce(() => new Promise(() => {}))
    renderCheckin()
    fireEvent.click(screen.getByRole('button', { name: askName }))
    const context = (mockCall.mock.calls[0][0] as { context: Parameters<typeof requestWeekReview>[1] }).context
    await requestWeekReview(review.asOf, context)
    expect(mockCall).toHaveBeenCalledTimes(1)
  })

  it('돌아보기가 실패하면 다시 시도 버튼 하나만 남고, 선택지는 그대로 고르고 저장할 수 있다', async () => {
    const { initial } = seed()
    signIn()
    mockCall.mockRejectedValue(new AiError('busy'))
    renderCheckin()
    fireEvent.click(screen.getByRole('button', { name: askName }))
    expect(await screen.findByRole('alert')).toHaveTextContent('지금 응답이 늦어요')
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: askName })).not.toBeInTheDocument()

    fireEvent.click(within(screen.getByTestId('option-keep')).getByRole('radio'))
    fireEvent.click(screen.getByRole('button', { name: '이대로 유지하기' }))
    expect(await savedCheckin()).toMatchObject({ kind: 'weekly', targetKcal: initial.targetKcal })
  })
})
