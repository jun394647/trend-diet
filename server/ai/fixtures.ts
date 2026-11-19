/** 테스트에서 함께 쓰는 예시 값. */
import type { AiRequest, AiResultMap, AiTask, CoachContext } from '../../src/ai/contract.ts'

export const sampleContext: CoachContext = {
  today: '2026-11-19',
  phase: 'lose',
  weekOfPhase: 3,
  breakUntil: null,
  sex: 'F',
  age: 34,
  heightCm: 162,
  startWeightKg: 68,
  goalWeightKg: 60,
  weeklyLossKg: 0.4,
  targetKcal: 1600,
  targetLow: 1500,
  targetHigh: 1700,
  estimatedTdee: 2040,
  trendKg: 66.2,
  weeklyRateKg: -0.35,
  todayKcal: 900,
  days: [
    { date: '2026-11-12', kcal: 1580, weightKg: 66.8 },
    { date: '2026-11-13', kcal: 1650, weightKg: null },
    { date: '2026-11-14', kcal: 2100, weightKg: 66.6 },
    { date: '2026-11-15', kcal: null, weightKg: null },
    { date: '2026-11-16', kcal: 1520, weightKg: 66.4 },
    { date: '2026-11-17', kcal: 1610, weightKg: null },
    { date: '2026-11-18', kcal: 1400, weightKg: 66.1 },
    { date: '2026-11-19', kcal: 900, weightKg: 66.0 },
  ],
  frequentMeals: [
    { name: '닭가슴살 샐러드', kcal: 350, count: 9 },
    { name: '김치찌개와 밥', kcal: 620, count: 6 },
  ],
  todayMeals: [
    { name: '그릭요거트', kcal: 180 },
    { name: '비빔밥', kcal: 720 },
  ],
}

export const sampleRequests: { [T in AiTask]: Extract<AiRequest, { task: T }> } = {
  'meal-text': { task: 'meal-text', text: '점심에 김치찌개랑 밥 한 공기, 계란말이 조금' },
  'meal-photo': { task: 'meal-photo', imageBase64: 'A'.repeat(200), mediaType: 'image/jpeg', note: '밥은 반만 먹었어요' },
  'week-review': { task: 'week-review', context: sampleContext },
  suggest: { task: 'suggest', context: sampleContext, wish: '따뜻한 국물' },
  ask: {
    task: 'ask',
    context: sampleContext,
    question: '주말에 외식이 있는데 어떻게 하면 좋을까요',
    history: [
      { role: 'user', text: '어제 많이 먹었어요' },
      { role: 'assistant', text: '주 평균으로 보면 범위 안이에요.' },
    ],
  },
}

export const sampleResults: AiResultMap = {
  'meal-text': {
    items: [
      { name: '김치찌개', amount: '1인분', kcal: 250, confidence: 'medium' },
      { name: '밥', amount: '1공기(210g)', kcal: 310, confidence: 'high' },
    ],
    note: '양이 적히지 않은 것은 1인분으로 봤어요.',
  },
  'meal-photo': { items: [], note: '사진에서 음식을 찾지 못했어요.' },
  'week-review': {
    headline: '주 평균이 범위 안이었어요.',
    wins: ['6일을 기록했어요.'],
    observations: ['토요일에 범위보다 높았어요.'],
    nextStep: '이번 주에도 아침을 기록해 보세요.',
  },
  suggest: { suggestions: [{ name: '닭가슴살 샐러드', kcal: 350, why: '자주 드시는 메뉴예요.' }], note: '600~800kcal 남았어요.' },
  ask: { answer: '외식 날은 범위 위쪽까지 써도 괜찮아요.' },
}

export const TASKS = Object.keys(sampleRequests) as AiTask[]
