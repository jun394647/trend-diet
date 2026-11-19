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
import { clearWeekReviewCache } from '../components/ai/WeekReviewCache'
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

  function signIn() {
    useAi.setState({ configured: true, checked: true })
    useSync.setState({ email: 'a@b.c', conflict: null })
  }

  beforeEach(() => {
    mockCall.mockReset()
    mockCall.mockResolvedValue({ result, usage: { used: 1, limit: 40 } })
    clearWeekReviewCache()
  })

  afterEach(() => {
    useAi.setState({ configured: false, checked: false, usage: null })
    useSync.setState({ email: null, conflict: null })
  })

  it('AI가 꺼져 있으면 돌아보기 구획이 없다', () => {
    seed()
    renderCheckin()
    expect(screen.queryByRole('heading', { name: 'AI 돌아보기' })).not.toBeInTheDocument()
    expect(screen.queryByText(/로그인하면 쓸 수 있어요/)).not.toBeInTheDocument()
  })

  it('로그인하지 않았으면 한 줄 안내만 보여 준다', () => {
    seed()
    useAi.setState({ configured: true, checked: true })
    renderCheckin()
    expect(screen.queryByRole('button', { name: 'AI로 돌아보기' })).not.toBeInTheDocument()
    expect(screen.getByText(/AI로 돌아보기는 로그인하면 쓸 수 있어요/)).toBeInTheDocument()
  })

  it('버튼을 누르기 전에는 호출하지 않고, 누르면 돌아본 내용을 보여 준다', async () => {
    seed()
    signIn()
    renderCheckin()
    expect(screen.getByRole('heading', { name: 'AI 돌아보기' })).toBeInTheDocument()
    expect(mockCall).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'AI로 돌아보기' }))
    const body = await screen.findByTestId('week-review')
    expect(mockCall).toHaveBeenCalledTimes(1)
    expect(mockCall.mock.calls[0][0]).toMatchObject({ task: 'week-review', context: { today: today() } })

    expect(body).toHaveTextContent('꾸준히 기록한 2주였어요')
    expect(within(within(body).getByRole('list', { name: '잘된 점' })).getAllByRole('listitem')).toHaveLength(2)
    expect(within(body).getByRole('list', { name: '눈에 띄는 점' })).toHaveTextContent('주말에 섭취가 조금 늘었어요')
    expect(within(body).getByText('다음 한 주에 해 볼 것')).toBeInTheDocument()
    expect(within(body).getByText('토요일 점심을 미리 정해 두기')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AI로 돌아보기' })).not.toBeInTheDocument()
    // 돌아보기 구획은 선택지보다 앞에 있다.
    const choice = screen.getByRole('heading', { name: '다음 한 주' })
    expect(body.compareDocumentPosition(choice) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('같은 날 화면을 나갔다 돌아와도 다시 호출하지 않는다', async () => {
    seed()
    signIn()
    const { unmount } = renderCheckin()
    fireEvent.click(screen.getByRole('button', { name: 'AI로 돌아보기' }))
    await screen.findByTestId('week-review')
    unmount()

    renderCheckin()
    expect(screen.getByTestId('week-review')).toHaveTextContent('꾸준히 기록한 2주였어요')
    expect(mockCall).toHaveBeenCalledTimes(1)
  })

  it('돌아보기가 실패해도 선택지는 그대로 고르고 저장할 수 있다', async () => {
    const { initial } = seed()
    signIn()
    mockCall.mockRejectedValue(new AiError('busy'))
    renderCheckin()
    fireEvent.click(screen.getByRole('button', { name: 'AI로 돌아보기' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('지금 응답이 늦어요')
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()

    fireEvent.click(within(screen.getByTestId('option-keep')).getByRole('radio'))
    fireEvent.click(screen.getByRole('button', { name: '이대로 유지하기' }))
    expect(await savedCheckin()).toMatchObject({ kind: 'weekly', targetKcal: initial.targetKcal })
  })
})
