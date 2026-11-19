import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { addDays, today } from '../lib/date'
import { buildInitialCheckin } from '../lib/plan'
import { computeTrend } from '../lib/trend'
import { useStore } from '../store'
import type { MealEntry, Profile, WeightEntry } from '../types'
import Trend from './Trend'

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
/** 4주 전에 감량을 시작한 프로필. */
const profile: Profile = { ...base, phase: 'lose', phaseStartedAt: addDays(today(), -27) }

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

beforeEach(async () => {
  await useStore.getState().resetAll()
})

function renderTrend() {
  return render(
    <MemoryRouter initialEntries={['/trend']}>
      <Trend />
    </MemoryRouter>,
  )
}

/** 오늘까지 days일 동안 매일 kgPerDay씩 변하는 체중 기록. */
function seedWeights(days: number, startKg = 80, kgPerDay = -0.1): WeightEntry[] {
  const start = addDays(today(), -(days - 1))
  return Array.from({ length: days }, (_, i) => ({
    date: addDays(start, i),
    kg: Math.round((startKg + i * kgPerDay) * 10) / 10,
  }))
}

describe('Trend', () => {
  it('기록이 전혀 없으면 체중과 식사 안내만 보여 준다', () => {
    renderTrend()
    expect(screen.getByText(/아직 체중 기록이 없어요/)).toBeInTheDocument()
    expect(screen.getByText(/이틀 이상 기록하면 추세선이 나타나요/)).toBeInTheDocument()
    expect(screen.getByText('이 기간에는 식사 기록이 없어요.')).toBeInTheDocument()
    expect(screen.queryByTestId('trend-current')).not.toBeInTheDocument()
    expect(screen.queryByTestId('trend-progress')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /체크인/ })).not.toBeInTheDocument()
  })

  it('체중 기록이 하나뿐이면 차트 대신 안내를 보여 준다', () => {
    const date = today()
    useStore.setState({
      profile,
      weights: [{ date, kg: 80 }],
      checkins: [buildInitialCheckin(profile, date)],
    })
    renderTrend()
    expect(screen.getByText(/이틀 이상 기록하면 추세선이 나타나요/)).toBeInTheDocument()
    expect(screen.getByTestId('trend-current')).toHaveTextContent('80.0')
    expect(screen.getByTestId('trend-progress')).toHaveTextContent(
      '시작 체중과 거의 같아요 · 다음 단계 79.0 kg까지 1.0 kg',
    )
  })

  it('기록이 쌓이면 진행 상황, 기간 변화, 예상 도달일을 보여 준다', () => {
    const weights = seedWeights(28)
    const points = computeTrend(weights)
    const current = points[points.length - 1].trend
    useStore.setState({
      profile,
      weights,
      checkins: [buildInitialCheckin(profile, weights[0].date)],
    })
    renderTrend()

    expect(screen.getByTestId('trend-current')).toHaveTextContent(current.toFixed(1))
    const next = Math.ceil(current) - 1
    expect(screen.getByTestId('trend-progress')).toHaveTextContent(
      `시작보다 ${(80 - current).toFixed(1)} kg 줄었어요 · 다음 단계 ${next.toFixed(1)} kg까지 ${(current - next).toFixed(1)} kg`,
    )
    expect(screen.queryByText(/이틀 이상 기록하면/)).not.toBeInTheDocument()
    const delta = current - points[0].trend
    expect(screen.getByTestId('trend-change')).toHaveTextContent(`−${Math.abs(delta).toFixed(1)} kg`)
    expect(screen.getByTestId('trend-rate')).toHaveTextContent(/^−\d\.\d\d kg\/주$/)
    expect(screen.getByText(/추세 체중이 80\.0 kg에서/)).toBeInTheDocument()
    expect(screen.getByTestId('trend-projection')).toHaveTextContent(/주 0\.5 kg씩 .*닿을 것 같아요/)
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('감량 4주차')
  })

  it('시작보다 체중이 늘었으면 그대로 알려 준다', () => {
    const weights = seedWeights(21, 81, 0.05)
    const points = computeTrend(weights)
    const current = points[points.length - 1].trend
    useStore.setState({ profile, weights, checkins: [buildInitialCheckin(profile, weights[0].date)] })
    renderTrend()
    expect(screen.getByTestId('trend-progress')).toHaveTextContent(
      `지금은 시작보다 ${(current - 80).toFixed(1)} kg 높아요`,
    )
  })

  it('기간을 바꾸면 그 기간의 변화량으로 바뀐다', () => {
    const weights = seedWeights(28)
    const points = computeTrend(weights)
    useStore.setState({ profile, weights, checkins: [buildInitialCheckin(profile, weights[0].date)] })
    renderTrend()

    fireEvent.click(screen.getByRole('button', { name: '2주' }))
    expect(screen.getByRole('button', { name: '2주' })).toHaveAttribute('aria-pressed', 'true')
    const visible = points.slice(-14)
    const delta = visible[visible.length - 1].trend - visible[0].trend
    expect(screen.getByTestId('trend-change')).toHaveTextContent(`−${Math.abs(delta).toFixed(1)} kg`)
  })

  it('목표에 닿은 유지 기간에는 목표 근처에 머무는 게 목표라고 알려 준다', () => {
    const maintaining: Profile = { ...base, phase: 'maintain', phaseStartedAt: addDays(today(), -10), breakUntil: null }
    const weights = seedWeights(14, 71.8, 0)
    useStore.setState({ profile: maintaining, weights, checkins: [buildInitialCheckin(maintaining, weights[0].date)] })
    renderTrend()

    expect(screen.getByTestId('trend-progress')).toHaveTextContent(
      '목표 체중에 닿았어요. 이제는 이 근처에 머무는 게 목표예요.',
    )
    expect(screen.queryByTestId('trend-projection')).not.toBeInTheDocument()
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('유지 중')
    expect(screen.getByText('하루 유지 범위')).toBeInTheDocument()
  })

  it('쉬어 가는 유지 기간에는 예상 도달일 대신 감량을 다시 시작하는 날을 알려 준다', () => {
    const resting: Profile = {
      ...base,
      phase: 'maintain',
      phaseStartedAt: addDays(today(), -4),
      breakUntil: addDays(today(), 10),
    }
    const weights = seedWeights(28)
    useStore.setState({ profile: resting, weights, checkins: [buildInitialCheckin(resting, weights[0].date)] })
    renderTrend()

    expect(screen.getByTestId('trend-projection')).toHaveTextContent(/쉬어 가는 유지 기간이에요.*부터 감량을 다시 시작해요/)
    expect(screen.getByTestId('trend-progress')).toHaveTextContent(/시작보다 .* kg 줄었어요/)
    expect(screen.getByTestId('phase-chip')).toHaveTextContent('쉬어 가는 유지 기간')
  })

  it('섭취 기록은 목표 범위 안, 많음, 적음으로 나눠 센다', () => {
    const weights = seedWeights(28)
    const initial = buildInitialCheckin(profile, weights[0].date)
    const t = initial.targetKcal
    const kcals = [t, t + 50, t + 300, t - 400]
    const meals: MealEntry[] = kcals.map((kcal, i) => {
      const date = addDays(today(), -i)
      return { id: `m${i}`, date, kcal, source: 'exact', createdAt: `${date}T12:00:00.000Z` }
    })
    useStore.setState({ profile, weights, meals, checkins: [initial] })
    renderTrend()

    expect(screen.getByTestId('intake-caption')).toHaveTextContent('범위 안 2일 · 많음 1일 · 적음 1일')
    expect(screen.getByTestId('plan-range')).toHaveTextContent(
      `${(t - 100).toLocaleString('ko-KR')}~${(t + 100).toLocaleString('ko-KR')} kcal`,
    )
  })

  it('체크인할 때가 되면 체크인 버튼을, 아니면 미리 하기 링크를 보여 준다', () => {
    const weights = seedWeights(28)
    useStore.setState({ profile, weights, checkins: [buildInitialCheckin(profile, weights[0].date)] })
    const { unmount } = renderTrend()
    const cta = screen.getByRole('link', { name: '주간 체크인 하기' })
    expect(cta).toHaveAttribute('href', '/checkin')
    expect(cta).toHaveClass('btn--primary')
    unmount()

    useStore.setState({ checkins: [buildInitialCheckin(profile, addDays(today(), -2))] })
    renderTrend()
    expect(screen.getByRole('link', { name: '미리 체크인하기' })).not.toHaveClass('btn--primary')
    expect(screen.getByTestId('plan-next')).toHaveTextContent('5일 뒤')
  })
})
