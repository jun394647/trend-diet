/**
 * 화면(브라우저)과 서버 함수(api/ai.ts)가 함께 쓰는 AI 기능의 약속.
 * 모든 요청은 POST /api/ai 한 곳으로 가고, task로 종류를 구분한다.
 * 서버는 이 스키마로 요청을 검증하고, Claude의 응답도 이 스키마에 맞춰 받는다.
 */
import { z } from 'zod'

/** 하루에 한 사람이 쓸 수 있는 AI 호출 수의 기본값. 서버 환경변수 AI_DAILY_LIMIT로 바꿀 수 있다. */
export const DEFAULT_DAILY_LIMIT = 40
/** 사진 한 장의 최대 크기(base64 글자 수). 약 3MB. */
export const MAX_IMAGE_BASE64 = 4_000_000

// ── 화면이 서버에 넘기는 내 기록 요약 ──────────────────────────────

/** 하루치 요약. kcal이 null이면 식사를 기록하지 않은 날이다. */
export const DaySchema = z.object({
  date: z.string(),
  kcal: z.number().nullable(),
  weightKg: z.number().nullable(),
})

/** AI에게 넘기는 내 상황. 개인 식별 정보는 넣지 않는다. */
export const CoachContextSchema = z.object({
  today: z.string(),
  phase: z.enum(['lose', 'maintain']),
  weekOfPhase: z.number(),
  breakUntil: z.string().nullable(),
  sex: z.enum(['M', 'F']),
  age: z.number(),
  heightCm: z.number(),
  startWeightKg: z.number(),
  goalWeightKg: z.number(),
  weeklyLossKg: z.number(),
  targetKcal: z.number(),
  targetLow: z.number(),
  targetHigh: z.number(),
  estimatedTdee: z.number(),
  trendKg: z.number().nullable(),
  /** 최근 2주 추세의 주당 변화(kg/주). 음수면 감량. */
  weeklyRateKg: z.number().nullable(),
  /** 오늘 지금까지 먹은 양. */
  todayKcal: z.number(),
  /** 최근 14일, 오래된 날부터. */
  days: z.array(DaySchema).max(31),
  /** 자주 먹는 것. */
  frequentMeals: z.array(z.object({ name: z.string(), kcal: z.number(), count: z.number() })).max(12),
  /** 오늘 먹은 것. */
  todayMeals: z.array(z.object({ name: z.string(), kcal: z.number() })).max(30),
})
export type CoachContext = z.infer<typeof CoachContextSchema>

// ── 요청 ──────────────────────────────────────────────────────

export const AiRequestSchema = z.discriminatedUnion('task', [
  /** 말로 적은 식사를 음식별 칼로리로 풀어 준다. */
  z.object({ task: z.literal('meal-text'), text: z.string().min(1).max(500) }),
  /** 음식 사진에서 음식별 칼로리를 추정한다. note는 사용자가 덧붙인 설명. */
  z.object({
    task: z.literal('meal-photo'),
    imageBase64: z.string().min(100).max(MAX_IMAGE_BASE64),
    mediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    note: z.string().max(200).optional(),
  }),
  /**
   * 지난 한 주를 돌아보고 다음 한 주에 해 볼 것을 알려 준다.
   * recommendation은 앱이 주간 체크인에서 이미 권하고 있는 선택지(예: '2주 쉬어 가기').
   * AI의 조언이 그것과 어긋나지 않게 하려고 넘긴다.
   */
  z.object({
    task: z.literal('week-review'),
    context: CoachContextSchema,
    recommendation: z.string().max(200).optional(),
  }),
  /** 오늘 남은 범위에 맞는 다음 끼를 제안한다. avoid는 이미 추천받아 이번에는 빼고 싶은 음식 이름들. */
  z.object({
    task: z.literal('suggest'),
    context: CoachContextSchema,
    wish: z.string().max(100).optional(),
    avoid: z.array(z.string().max(60)).max(12).optional(),
  }),
  /** 코치에게 자유롭게 묻는다. history는 이전 대화(오래된 것부터). */
  z.object({
    task: z.literal('ask'),
    context: CoachContextSchema,
    question: z.string().min(1).max(500),
    history: z
      .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }))
      .max(20)
      .default([]),
  }),
])
export type AiRequest = z.infer<typeof AiRequestSchema>
export type AiTask = AiRequest['task']

// ── 응답 ──────────────────────────────────────────────────────

/** 추정한 음식 하나. */
export const MealItemSchema = z.object({
  /** 음식 이름. 40자 이내의 한국어. */
  name: z.string(),
  /** 가정한 양. 예: '1공기(210g)', '1인분', '2조각' */
  amount: z.string(),
  kcal: z.number(),
  /** 추정을 얼마나 믿을 만한지. */
  confidence: z.enum(['high', 'medium', 'low']),
})
export type MealItem = z.infer<typeof MealItemSchema>

export const MealEstimateSchema = z.object({
  items: z.array(MealItemSchema),
  /** 사용자에게 보여 줄 한두 문장. 무엇을 가정했는지, 음식이 아니면 왜 추정하지 못했는지. */
  note: z.string(),
})
export type MealEstimate = z.infer<typeof MealEstimateSchema>

export const WeekReviewSchema = z.object({
  /** 한 줄 요약. */
  headline: z.string(),
  /** 잘된 점 1~3가지. */
  wins: z.array(z.string()),
  /** 눈에 띄는 흐름 1~3가지. 판단이 아니라 관찰로 적는다. */
  observations: z.array(z.string()),
  /** 다음 한 주에 해 볼 한 가지. */
  nextStep: z.string(),
})
export type WeekReview = z.infer<typeof WeekReviewSchema>

export const SuggestionsSchema = z.object({
  suggestions: z.array(
    z.object({
      name: z.string(),
      kcal: z.number(),
      /** 왜 이걸 권하는지 한 문장. */
      why: z.string(),
    }),
  ),
  note: z.string(),
})
export type Suggestions = z.infer<typeof SuggestionsSchema>

export const AnswerSchema = z.object({ answer: z.string() })
export type Answer = z.infer<typeof AnswerSchema>

/** task별 응답 본문의 타입. */
export interface AiResultMap {
  'meal-text': MealEstimate
  'meal-photo': MealEstimate
  'week-review': WeekReview
  suggest: Suggestions
  ask: Answer
}

export interface AiUsage {
  /** 오늘 쓴 횟수(이번 호출 포함)와 하루 한도. */
  used: number
  limit: number
}

export type AiResponse<T extends AiTask = AiTask> = { ok: true; result: AiResultMap[T]; usage: AiUsage }

/**
 * 실패 사유.
 *  - not_configured: 서버에 API 키가 없다.
 *  - unauthorized: 로그인하지 않았거나 로그인이 만료됐다.
 *  - forbidden: 이 계정은 AI 기능을 쓸 수 없다(허용 목록에 없음).
 *  - limit: 오늘 한도를 다 썼다.
 *  - bad_request: 요청 형식이 틀렸다.
 *  - refused: 모델이 답하지 않았다.
 *  - busy: 잠시 뒤에 다시 시도하면 될 수 있다(혼잡, 시간 초과).
 *  - failed: 그 밖의 서버 오류.
 */
export type AiErrorCode =
  | 'not_configured'
  | 'unauthorized'
  | 'forbidden'
  | 'limit'
  | 'bad_request'
  | 'refused'
  | 'busy'
  | 'failed'

export interface AiErrorBody {
  ok: false
  error: AiErrorCode
  /** 한도를 넘었을 때, 그리고 횟수를 쓴 뒤에 실패했을 때 함께 온다. 화면은 이 값으로 남은 횟수를 고친다. */
  usage?: AiUsage
}

/** GET /api/ai 의 응답. 화면이 AI 기능을 보여 줄지 정할 때 쓴다. */
export interface AiStatus {
  configured: boolean
  dailyLimit: number
}
