import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { addDays, today } from '../lib/date'
import { buildCheckinProposal, buildInitialCheckin } from '../lib/plan'
import { useStore } from '../store'
import type { Checkin as CheckinRecord, MealEntry, Profile, WeightEntry } from '../types'
import Checkin from './Checkin'

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

/** 4주 동안 매일 체중(하루 0.1kg 감소)과 식사(2,000kcal)를 기록한 상태. */
function seedFourWeeks(): { initial: CheckinRecord; expectedTarget: number; expectedTdee: number } {
  const days = 28
  const start = addDays(today(), -(days - 1))
  const weights: WeightEntry[] = []
  const meals: MealEntry[] = []
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i)
    weights.push({ date, kg: Math.round((80 - i * 0.1) * 10) / 10 })
    meals.push({ id: `m${i}`, date, kcal: 2000, source: 'exact', createdAt: `${date}T12:00:00.000Z` })
  }
  const initial = buildInitialCheckin(profile, start)
  useStore.setState({ profile, weights, meals, checkins: [initial] })
  const proposal = buildCheckinProposal({ profile, weights, meals, checkins: [initial], asOf: today() })
  if (!proposal) throw new Error('proposal should exist')
  return { initial, expectedTarget: proposal.target.targetKcal, expectedTdee: proposal.estimate.tdee }
}

describe('Checkin', () => {
  it('계획이 없으면 홈으로 가는 안내를 보여 준다', () => {
    renderCheckin()
    expect(screen.getByRole('link', { name: '홈으로 가기' })).toHaveAttribute('href', '/')
  })

  it('기록이 부족하면 이전 추정치를 유지한다고 알려 준다', () => {
    const date = addDays(today(), -2)
    const initial = buildInitialCheckin(profile, date)
    useStore.setState({ profile, weights: [{ date, kg: 80 }], meals: [], checkins: [initial] })
    renderCheckin()

    expect(screen.getByText(/기록이 아직 부족해서 이전 추정치를 그대로 둘게요/)).toBeInTheDocument()
    expect(screen.getByText('지금 0일')).toBeInTheDocument()
    expect(screen.getByText('지금 1회')).toBeInTheDocument()
    expect(screen.getByText(/마지막 체크인이/)).toBeInTheDocument()
    // 목표가 그대로면 버튼은 하나만 보인다.
    expect(screen.getByRole('button', { name: '확인' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '새 목표로 바꾸기' })).not.toBeInTheDocument()
  })

  it('새 목표로 바꾸면 제안한 목표로 주간 체크인을 저장하고 홈으로 간다', async () => {
    const { initial, expectedTarget, expectedTdee } = seedFourWeeks()
    expect(expectedTarget).not.toBe(initial.targetKcal)
    renderCheckin()

    expect(screen.getByTestId('checkin-target')).toHaveTextContent(expectedTarget.toLocaleString('ko-KR'))
    expect(screen.getByText(/평균 섭취량과 추세 체중 변화로 계산했어요/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '새 목표로 바꾸기' }))

    await waitFor(() => expect(useStore.getState().checkins).toHaveLength(2))
    const saved = useStore.getState().checkins[1]
    expect(saved).toMatchObject({
      date: today(),
      kind: 'weekly',
      targetKcal: expectedTarget,
      estimatedTdee: expectedTdee,
    })
    expect(saved.trendKg).not.toBeNull()
    expect(await screen.findByText('홈 화면')).toBeInTheDocument()
  })

  it('지금 목표를 유지하면 이전 목표 그대로 체크인을 저장한다', async () => {
    const { initial } = seedFourWeeks()
    renderCheckin()

    fireEvent.click(screen.getByRole('button', { name: '지금 목표 유지하기' }))

    await waitFor(() => expect(useStore.getState().checkins).toHaveLength(2))
    expect(useStore.getState().checkins[1]).toMatchObject({
      date: today(),
      kind: 'weekly',
      targetKcal: initial.targetKcal,
      estimatedTdee: initial.estimatedTdee,
    })
    expect(await screen.findByText('홈 화면')).toBeInTheDocument()
  })
})
