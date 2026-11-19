// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { CoachContext } from '../../src/ai/contract.ts'
import { TASKS, sampleContext, sampleRequests } from './fixtures.ts'
import {
  buildAskPrompt,
  buildMealPhotoPrompt,
  buildMealTextPrompt,
  buildPrompt,
  buildSuggestPrompt,
  buildWeekReviewPrompt,
  contextBlock,
  type Prompt,
} from './prompts.ts'

/** 프롬프트에서 글자 부분만 모은다(사진 데이터는 뺀다). */
function textOf(p: Prompt): string {
  const parts = [p.system]
  for (const m of p.messages) {
    if (typeof m.content === 'string') parts.push(m.content)
    else if (m.content) for (const b of m.content) if (b.type === 'text') parts.push(b.text)
  }
  return parts.join('\n')
}

function contextJson(text: string): Record<string, unknown> {
  const line = text.split('\n').find((l) => l.startsWith('내 기록 요약: '))
  if (!line) throw new Error('context line not found')
  return JSON.parse(line.slice('내 기록 요약: '.length)) as Record<string, unknown>
}

describe('모든 task에 공통', () => {
  it.each(TASKS)('%s: 시스템 프롬프트가 있고 undefined/NaN이 섞이지 않는다', (task) => {
    const p = buildPrompt(sampleRequests[task])
    expect(p.system.length).toBeGreaterThan(200)
    expect(p.system).toContain('해요체')
    expect(p.messages.length).toBeGreaterThan(0)
    expect(p.messages[p.messages.length - 1].role).toBe('user')
    const text = textOf(p)
    expect(text).not.toMatch(/undefined|NaN|\[object Object\]|Infinity/)
  })

  it('시스템 프롬프트는 요청 내용에 따라 바뀌지 않는다', () => {
    expect(buildMealTextPrompt({ task: 'meal-text', text: '라면' }).system).toBe(buildMealTextPrompt(sampleRequests['meal-text']).system)
    const other: CoachContext = { ...sampleContext, phase: 'maintain', todayKcal: 2500, breakUntil: '2026-12-01' }
    expect(buildWeekReviewPrompt({ task: 'week-review', context: other }).system).toBe(buildWeekReviewPrompt(sampleRequests['week-review']).system)
    expect(buildSuggestPrompt({ task: 'suggest', context: other }).system).toBe(buildSuggestPrompt(sampleRequests.suggest).system)
    expect(buildAskPrompt({ task: 'ask', context: other, question: '다른 질문', history: [] }).system).toBe(buildAskPrompt(sampleRequests.ask).system)
  })

  it('선택 항목이 없어도 undefined/NaN이 나오지 않는다', () => {
    const odd: CoachContext = {
      ...sampleContext,
      trendKg: null,
      weeklyRateKg: null,
      todayKcal: Number.NaN,
      estimatedTdee: Number.POSITIVE_INFINITY,
      days: [],
      frequentMeals: [],
      todayMeals: [],
    }
    const prompts = [
      buildMealPhotoPrompt({ task: 'meal-photo', imageBase64: 'A'.repeat(200), mediaType: 'image/webp' }),
      buildMealPhotoPrompt({ task: 'meal-photo', imageBase64: 'A'.repeat(200), mediaType: 'image/webp', note: '   ' }),
      buildSuggestPrompt({ task: 'suggest', context: odd }),
      buildWeekReviewPrompt({ task: 'week-review', context: odd }),
      buildAskPrompt({ task: 'ask', context: odd, question: '질문', history: [] }),
    ]
    for (const p of prompts) expect(textOf(p)).not.toMatch(/undefined|NaN|Infinity/)
    const ctx = contextJson(textOf(prompts[2]))
    expect(ctx.todayKcal).toBeNull()
    expect(ctx.remaining).toEqual({ low: null, high: null })
    expect(ctx.recent7).toMatchObject({ loggedDays: 0, avgKcal: null })
  })
})

describe('contextBlock', () => {
  it('범례 한 줄과 압축 JSON으로 기록 요약을 담는다', () => {
    const block = contextBlock(sampleContext)
    const lines = block.split('\n')
    expect(lines).toHaveLength(2)
    expect(lines[0].startsWith('범례:')).toBe(true)
    const ctx = contextJson(block)
    expect(ctx).toMatchObject({
      today: '2026-11-19',
      phase: 'lose',
      targetLow: 1500,
      targetHigh: 1700,
      todayKcal: 900,
      frequentMeals: sampleContext.frequentMeals,
      todayMeals: sampleContext.todayMeals,
      days: sampleContext.days,
    })
  })

  it('남은 범위와 오늘을 뺀 최근 7일 요약을 미리 셈해 넣는다', () => {
    const ctx = contextJson(contextBlock(sampleContext))
    expect(ctx.remaining).toEqual({ low: 600, high: 800 })
    // 11-12 ~ 11-18: 1580, 1650, 2100, 없음, 1520, 1610, 1400
    expect(ctx.recent7).toEqual({ days: 7, loggedDays: 6, avgKcal: 1643, daysInRange: 4, daysOver: 1, daysUnder: 1 })
  })
})

describe('meal-text', () => {
  it('적은 글을 user 턴에 넣고, 원칙은 시스템 프롬프트에 둔다', () => {
    const p = buildMealTextPrompt(sampleRequests['meal-text'])
    expect(p.messages).toHaveLength(1)
    expect(p.messages[0].content).toContain('점심에 김치찌개랑 밥 한 공기, 계란말이 조금')
    expect(p.system).not.toContain('계란말이 조금, ')
    expect(p.system).toContain('confidence')
    expect(p.system).toContain('10 단위')
    expect(p.system).toContain('40자')
  })
})

describe('meal-photo', () => {
  it('사진 블록 다음에 글 블록을 보내고 덧붙인 설명을 넣는다', () => {
    const p = buildMealPhotoPrompt(sampleRequests['meal-photo'])
    const content = p.messages[0].content
    if (!content || typeof content === 'string') throw new Error('expected blocks')
    expect(content.map((b) => b.type)).toEqual(['image', 'text'])
    expect(content[0]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'A'.repeat(200) } })
    expect(content[1]).toMatchObject({ type: 'text' })
    expect(textOf(p)).toContain('밥은 반만 먹었어요')
  })
})

describe('week-review', () => {
  it('기록 요약을 user 턴에 넣는다', () => {
    const p = buildWeekReviewPrompt(sampleRequests['week-review'])
    expect(p.messages).toHaveLength(1)
    expect(contextJson(String(p.messages[0].content))).toMatchObject({ weekOfPhase: 3, weeklyRateKg: -0.35 })
    expect(p.system).toContain('450자')
    expect(p.system).toContain('유지 휴식')
  })
})

describe('suggest', () => {
  it('기록 요약과 바라는 것을 user 턴에 넣는다', () => {
    const p = buildSuggestPrompt(sampleRequests.suggest)
    const text = String(p.messages[0].content)
    expect(contextJson(text).remaining).toEqual({ low: 600, high: 800 })
    expect(text).toContain('따뜻한 국물')
    expect(text).toContain('닭가슴살 샐러드')
  })

  it('오늘 범위를 넘었으면 남은 범위가 음수로 들어간다', () => {
    const p = buildSuggestPrompt({ task: 'suggest', context: { ...sampleContext, todayKcal: 1900 } })
    expect(contextJson(String(p.messages[0].content)).remaining).toEqual({ low: -400, high: -200 })
  })
})

describe('ask', () => {
  const roles = (p: Prompt) => p.messages.map((m) => m.role)

  it('history를 번갈아 오는 메시지로 바꾸고 새 질문을 마지막에 둔다', () => {
    const p = buildAskPrompt(sampleRequests.ask)
    expect(roles(p)).toEqual(['user', 'assistant', 'user'])
    expect(p.messages[0].content).toBe('어제 많이 먹었어요')
    expect(p.messages[1].content).toBe('주 평균으로 보면 범위 안이에요.')
    const last = String(p.messages[2].content)
    expect(last).toContain('질문: 주말에 외식이 있는데 어떻게 하면 좋을까요')
    expect(contextJson(last)).toMatchObject({ today: '2026-11-19' })
  })

  it('history가 없으면 질문 하나만 보낸다', () => {
    const p = buildAskPrompt({ task: 'ask', context: sampleContext, question: '물은 얼마나 마셔요', history: [] })
    expect(roles(p)).toEqual(['user'])
  })

  it('어긋난 history도 user로 시작해 번갈아 오게 맞춘다', () => {
    const p = buildAskPrompt({
      task: 'ask',
      context: sampleContext,
      question: '새 질문',
      history: [
        { role: 'assistant', text: '앞머리 답' },
        { role: 'user', text: '첫 질문' },
        { role: 'user', text: '덧붙임' },
        { role: 'assistant', text: '답 1' },
        { role: 'assistant', text: '답 2' },
        { role: 'user', text: '   ' },
        { role: 'user', text: '답을 못 받은 질문' },
      ],
    })
    expect(roles(p)).toEqual(['user', 'assistant', 'user'])
    expect(p.messages[0].content).toBe('첫 질문\n\n덧붙임')
    expect(p.messages[1].content).toBe('답 1\n\n답 2')
    const last = String(p.messages[2].content)
    expect(last).toContain('답을 못 받은 질문')
    expect(last).toContain('새 질문')
    expect(textOf(p)).not.toContain('앞머리 답')
    for (let i = 1; i < p.messages.length; i++) expect(p.messages[i].role).not.toBe(p.messages[i - 1].role)
  })
})
