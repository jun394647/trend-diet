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
  /** 로그인 토큰을 함께 보냈을 때만 온다: 오늘 이미 쓴 횟수. 알 수 없으면 없다. */
  used?: number
}

// ── 조금씩 받는 응답(스트리밍) ──────────────────────────────────────
//
// 글로 읽는 task(ask, week-review)는 다 쓰일 때까지 기다리지 않고 쓰이는 대로 받을 수 있다.
// 화면이 요청에 `Accept: text/event-stream` 을 붙이면, 서버는 로그인·형식·한도 확인까지는 평소처럼 하고
// (거기서 실패하면 평소와 같은 JSON 오류와 상태 코드로 답한다) 그 뒤로는 HTTP 200에 SSE로 보낸다.
// 사건 하나는 `data: <JSON 한 줄>` 과 빈 줄이고, JSON의 type으로 종류를 구분한다.
//
//   data: {"type":"start","usage":{…}}        횟수를 쓴 직후 한 번. 이때부터 오늘 사용량을 알 수 있다.
//   data: {"type":"partial","result":{…}}     지금까지 쓰인 만큼. 매번 처음부터 지금까지의 전체이므로 앞의 것을 덮어쓰면 된다.
//   data: {"type":"done","ok":true,"result":{…},"usage":{…}}     마지막. 평소 응답(AiResponse)과 같은 내용.
//   data: {"type":"error","ok":false,"error":"busy","usage":{…}}  마지막. 평소 오류(AiErrorBody)와 같은 내용.
//
// done이나 error 없이 끊기면 받지 못한 것이다(화면은 busy로 다룬다). partial은 화면에 미리 보여 주는 용도일 뿐이고,
// 저장하거나 다음 요청에 쓰는 값은 언제나 done의 result다. Accept를 붙이지 않으면 예전처럼 JSON 한 덩어리로 답한다.

/** 조금씩 받겠다고 알리는 Accept 값이자, 그렇게 답할 때의 Content-Type. */
export const AI_STREAM_MIME = 'text/event-stream'

/** 조금씩 받을 수 있는 task. 그 밖의 task는 Accept를 붙여도 JSON 한 덩어리로 답한다. */
export const AI_STREAM_TASKS = ['ask', 'week-review'] as const
export type AiStreamTask = (typeof AI_STREAM_TASKS)[number]

export function isAiStreamTask(task: string): task is AiStreamTask {
  return (AI_STREAM_TASKS as readonly string[]).includes(task)
}

/**
 * 쓰이는 중인 결과. 완성된 결과와 필드 이름과 뜻이 같고, 아직 쓰이지 않은 필드는 없다.
 * 글은 쓰인 데까지만 들어 있고(마지막 문장이 끊겨 있을 수 있다), 목록은 쓰인 항목까지만 들어 있다.
 */
export interface AiPartialMap {
  ask: { answer: string }
  'week-review': { headline?: string; wins?: string[]; observations?: string[]; nextStep?: string }
}
export type WeekReviewPartial = AiPartialMap['week-review']

export type AiStreamEvent<T extends AiTask = AiTask> =
  | { type: 'start'; usage: AiUsage }
  | { type: 'partial'; result: T extends AiStreamTask ? AiPartialMap[T] : never }
  | ({ type: 'done' } & AiResponse<T>)
  | ({ type: 'error' } & AiErrorBody)
