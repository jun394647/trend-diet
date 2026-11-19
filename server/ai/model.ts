/**
 * Claude 호출. 요청 하나를 받아 구조화된 결과 또는 계약의 실패 사유로 돌려준다.
 * SDK 클라이언트를 직접 쓰는 곳은 이 파일뿐이다.
 */
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import {
  AnswerSchema,
  MealEstimateSchema,
  SuggestionsSchema,
  WeekReviewSchema,
  type AiErrorCode,
  type AiRequest,
  type AiResultMap,
  type AiTask,
} from '../../src/ai/contract.ts'
import { buildPrompt } from './prompts.ts'

/** 쓰는 모델. 바꿀 때는 여기 한 곳만 고친다. */
export const MODEL = 'claude-opus-5-5'
export const MAX_TOKENS = 16000
/** 모델이 답을 거절하면 서버가 다른 모델로 같은 요청을 이어서 처리하게 한다. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** 한 번의 시도에 주는 시간과, 재시도를 포함한 전체 시간(ms). 함수 제한 60초보다 넉넉히 짧게 둔다. */
export const ATTEMPT_TIMEOUT_MS = 40_000
export const TOTAL_TIMEOUT_MS = 50_000

export const EFFORT: Record<AiTask, 'low' | 'medium'> = {
  'meal-text': 'low',
  'meal-photo': 'low',
  suggest: 'low',
  'week-review': 'medium',
  ask: 'medium',
}

const SCHEMAS = {
  'meal-text': MealEstimateSchema,
  'meal-photo': MealEstimateSchema,
  'week-review': WeekReviewSchema,
  suggest: SuggestionsSchema,
  ask: AnswerSchema,
} as const

export interface CallModelArgs {
  request: AiRequest
  userId: string
}
export type ModelOutcome = { ok: true; result: AiResultMap[AiTask] } | { ok: false; error: AiErrorCode }
export type CallModel = (args: CallModelArgs) => Promise<ModelOutcome>

/** 테스트에서 가짜로 바꿔 끼우는 부분. 실제로는 client.beta.messages.parse다. */
type BetaMessages = Anthropic['beta']['messages']
export type ParseParams = Parameters<BetaMessages['parse']>[0]
export interface ParsedLike {
  stop_reason: string | null
  parsed_output: unknown
  model?: string
  usage?: { input_tokens?: number | null; output_tokens?: number | null } | null
}
export type ParseFn = (params: ParseParams, options: { signal: AbortSignal }) => Promise<ParsedLike>

export function buildParams(request: AiRequest): ParseParams {
  const { system, messages } = buildPrompt(request)
  return {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    // 이 모델은 생각하기가 늘 켜져 있다. thinking은 보내지 않고 깊이는 effort로만 조절한다.
    output_config: { effort: EFFORT[request.task], format: betaZodOutputFormat(SCHEMAS[request.task]) },
    betas: [FALLBACK_BETA],
    fallbacks: 'default',
    system,
    messages,
  }
}

/** SDK 오류를 계약의 실패 사유로 바꾼다. 구체적인 것부터 본다. */
export function mapSdkError(e: unknown): AiErrorCode {
  if (e instanceof Anthropic.RateLimitError) return 'busy'
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return 'not_configured'
  if (e instanceof Anthropic.BadRequestError) return 'failed'
  // 시간 초과(APIConnectionTimeoutError)는 APIConnectionError의 하위 클래스다.
  if (e instanceof Anthropic.APIConnectionError || e instanceof Anthropic.APIUserAbortError) return 'busy'
  if (e instanceof Anthropic.InternalServerError) return 'busy'
  if (e instanceof Anthropic.APIError && typeof e.status === 'number' && (e.status >= 500 || e.status === 408)) return 'busy'
  // 전체 시간 제한(AbortSignal.timeout)에 걸린 경우.
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'busy'
  return 'failed'
}

const roundTo10 = (n: number): number => Math.max(0, Math.round(n / 10) * 10)

/** 스키마로 한 번 더 확인하고, 숫자와 이름을 계약에 맞게 다듬는다. 맞지 않으면 null. */
export function tidyResult(task: AiTask, parsed: unknown): AiResultMap[AiTask] | null {
  switch (task) {
    case 'meal-text':
    case 'meal-photo': {
      const r = MealEstimateSchema.safeParse(parsed)
      if (!r.success) return null
      return {
        ...r.data,
        items: r.data.items.map((it) => ({ ...it, name: it.name.trim().slice(0, 40), kcal: roundTo10(it.kcal) })),
      }
    }
    case 'suggest': {
      const r = SuggestionsSchema.safeParse(parsed)
      if (!r.success) return null
      return { ...r.data, suggestions: r.data.suggestions.map((s) => ({ ...s, kcal: roundTo10(s.kcal) })) }
    }
    case 'week-review': {
      const r = WeekReviewSchema.safeParse(parsed)
      return r.success ? r.data : null
    }
    case 'ask': {
      const r = AnswerSchema.safeParse(parsed)
      return r.success && r.data.answer.trim() ? r.data : null
    }
  }
}

/** parse 함수를 받아 callModel을 만든다. 사용자의 글, 사진, 키는 로그에 남기지 않는다. */
export function createCallModel(parse: ParseFn): CallModel {
  return async ({ request, userId }) => {
    const task = request.task
    const started = Date.now()
    const base = { evt: 'ai', task, user: userId, model: MODEL }
    try {
      const message = await parse(buildParams(request), { signal: AbortSignal.timeout(TOTAL_TIMEOUT_MS) })
      const log = {
        ...base,
        ms: Date.now() - started,
        servedBy: message.model ?? MODEL,
        stop: message.stop_reason,
        in: message.usage?.input_tokens ?? null,
        out: message.usage?.output_tokens ?? null,
      }
      // 내용을 믿기 전에 stop_reason부터 본다.
      if (message.stop_reason === 'refusal') {
        console.log(JSON.stringify({ ...log, result: 'refused' }))
        return { ok: false, error: 'refused' }
      }
      const result =
        message.stop_reason === 'max_tokens' || message.parsed_output == null ? null : tidyResult(task, message.parsed_output)
      if (!result) {
        console.log(JSON.stringify({ ...log, result: 'failed' }))
        return { ok: false, error: 'failed' }
      }
      console.log(JSON.stringify({ ...log, result: 'ok' }))
      return { ok: true, result }
    } catch (e) {
      const error = mapSdkError(e)
      const api = e instanceof Anthropic.APIError ? e : null
      console.log(
        JSON.stringify({
          ...base,
          ms: Date.now() - started,
          result: error,
          errorClass: e instanceof Error ? e.constructor.name : typeof e,
          status: api?.status ?? null,
          requestId: api?.requestID ?? null,
          // 400은 우리가 보낸 요청이 틀렸다는 뜻이라 원인을 남긴다(API의 설명일 뿐 사용자 글은 아니다).
          detail: e instanceof Anthropic.BadRequestError ? (api?.apiMessage ?? e.message) : undefined,
        }),
      )
      return { ok: false, error }
    }
  }
}

let cached: CallModel | undefined

/** 실제 SDK로 부르는 callModel. 클라이언트는 콜드 스타트마다 한 번만 만든다. */
export function anthropicCallModel(): CallModel {
  return (args) => {
    if (!cached) {
      // ANTHROPIC_API_KEY는 SDK가 환경변수에서 읽는다.
      const client = new Anthropic({ maxRetries: 1, timeout: ATTEMPT_TIMEOUT_MS })
      cached = createCallModel((params, options) => client.beta.messages.parse(params, options))
    }
    return cached(args)
  }
}
