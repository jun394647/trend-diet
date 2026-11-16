import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { addDays, today } from '../lib/date'
import { buildInitialCheckin } from '../lib/plan'
import { computeTrend } from '../lib/trend'
import { useStore } from '../store'
import type { Profile, WeightEntry } from '../types'
import Trend from './Trend'

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

/** 오늘까지 days일 동안 매일 0.1kg씩 줄어드는 체중 기록. */
function seedWeights(days: number): WeightEntry[] {
  const start = addDays(today(), -(days - 1))
  return Array.from({ length: days }, (_, i) => ({
    date: addDays(start, i),
    kg: Math.round((80 - i * 0.1) * 10) / 10,
  }))
}

describe('Trend', () => {
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
  })

  it('기록이 쌓이면 현재 추세 체중과 기간 변화를 보여 준다', () => {
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
    expect(screen.queryByText(/이틀 이상 기록하면/)).not.toBeInTheDocument()
    const delta = current - points[0].trend
    expect(screen.getByText(`−${Math.abs(delta).toFixed(1)}kg`)).toBeInTheDocument()
    expect(screen.getByText(/추세 체중이 80\.0kg에서/)).toBeInTheDocument()
    expect(screen.getByText(/이 속도면 약/)).toBeInTheDocument()
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
    expect(screen.getByText(`−${Math.abs(delta).toFixed(1)}kg`)).toBeInTheDocument()
  })

  it('체크인할 때가 되면 체크인 버튼을, 아니면 미리 하기 링크를 보여 준다', () => {
    const weights = seedWeights(28)
    useStore.setState({ profile, weights, checkins: [buildInitialCheckin(profile, weights[0].date)] })
    const { unmount } = renderTrend()
    expect(screen.getByRole('link', { name: '주간 체크인 하기' })).toHaveAttribute('href', '/checkin')
    unmount()

    useStore.setState({ checkins: [buildInitialCheckin(profile, addDays(today(), -2))] })
    renderTrend()
    expect(screen.getByRole('link', { name: '미리 체크인하기' })).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })
})
