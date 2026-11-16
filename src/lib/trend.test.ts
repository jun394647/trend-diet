import { computeTrend, trendAt } from './trend'

describe('computeTrend', () => {
  it('첫 값은 그대로 추세가 된다', () => {
    expect(computeTrend([{ date: '2026-01-01', kg: 80 }])).toEqual([
      { date: '2026-01-01', kg: 80, trend: 80 },
    ])
  })

  it('하루 간격이면 변화의 10%만 따라간다', () => {
    const t = computeTrend([
      { date: '2026-01-01', kg: 80 },
      { date: '2026-01-02', kg: 81 },
    ])
    expect(t[1].trend).toBeCloseTo(80.1, 10)
  })

  it('기록이 빠진 날이 있어도 매일 같은 값을 잰 것과 같은 결과가 나온다', () => {
    const gap = computeTrend([
      { date: '2026-01-01', kg: 80 },
      { date: '2026-01-04', kg: 79 },
    ])
    const daily = computeTrend([
      { date: '2026-01-01', kg: 80 },
      { date: '2026-01-02', kg: 79 },
      { date: '2026-01-03', kg: 79 },
      { date: '2026-01-04', kg: 79 },
    ])
    expect(gap[1].trend).toBeCloseTo(daily[3].trend, 10)
  })

  it('입력 순서와 무관하게 날짜순으로 계산한다', () => {
    const t = computeTrend([
      { date: '2026-01-02', kg: 81 },
      { date: '2026-01-01', kg: 80 },
    ])
    expect(t.map((p) => p.date)).toEqual(['2026-01-01', '2026-01-02'])
  })

  it('하루 튀는 값에 추세가 크게 흔들리지 않는다', () => {
    const t = computeTrend([
      { date: '2026-01-01', kg: 70 },
      { date: '2026-01-02', kg: 70 },
      { date: '2026-01-03', kg: 72 },
      { date: '2026-01-04', kg: 70 },
    ])
    expect(Math.abs(t[3].trend - 70)).toBeLessThan(0.25)
  })
})

describe('trendAt', () => {
  const pts = computeTrend([
    { date: '2026-01-01', kg: 80 },
    { date: '2026-01-05', kg: 79 },
  ])
  it('해당 날짜 이전의 가장 최근 값을 준다', () => {
    expect(trendAt(pts, '2026-01-03')).toBe(80)
    expect(trendAt(pts, '2026-01-05')).toBe(pts[1].trend)
  })
  it('기록 이전 날짜면 null', () => {
    expect(trendAt(pts, '2025-12-31')).toBeNull()
  })
})
