/**
 * Claude 호출. 요청 하나를 받아 구조화된 결과 또는 계약의 실패 사유로 돌려준다.
 * SDK 클라이언트를 직접 쓰는 곳은 이 파일뿐이다.
 */
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { z } from 'zod'
import {
  AnswerSchema,
  MealEstimateSchema,
  SuggestionsSchema,
  WeekReviewSchema,
  isAiStreamTask,
  type AiErrorCode,
  type AiPartialMap,
  type AiResultMap,
  type AiStreamTask,
} from '../../src/ai/contract.ts'
import { partialResult } from './partial.ts'
import { buildPrompt, type ModelRequest, type ModelTask } from './prompts.ts'

/** 코치가 먼저 건네는 한마디(서버 전용 task 'nudge')의 응답. */
export const NudgeSchema = z.object({
  /** 디스코드로 그대로 보낼 한국어 줄글. */
  message: z.string(),
})
export type Nudge = z.infer<typeof NudgeSchema>

/** task별 결과. 브라우저 계약의 다섯 가지에 서버 전용 task를 더한 것. */
export interface ModelResultMap extends AiResultMap {
  nudge: Nudge
}

// ── 모델과 설정 ────────────────────────────────────────────────

/**
 * 고를 수 있는 모델과, 모델마다 다른 규칙. 여기 없는 이름은 쓰지 않는다(틀린 이름은 API 오류가 된다).
 *  - thinkingOff: 생각하기를 끄는 thinking 값. null이면 끌 수 없는 모델이다(effort로만 조절한다).
 *  - serverFallback: 모델이 거절했을 때 서버가 다른 모델로 이어서 처리해 주는지. 없으면 거절은 그대로 refused가 된다.
 *  - fastMode: speed: 'fast'(같은 모델이 더 빨리 쓴다, 값은 두 배)를 받는지.
 */
export const MODEL_RULES = {
  'claude-opus-5-5': { thinkingOff: null, serverFallback: true, fastMode: true },
  'claude-sonnet-5-5': { thinkingOff: { type: 'between_tools' }, serverFallback: true, fastMode: false },
  'claude-haiku-5-5': { thinkingOff: { type: 'disabled' }, serverFallback: false, fastMode: false },
} as const
export type ModelId = keyof typeof MODEL_RULES
export const EFFORTS = ['low', 'medium', 'high'] as const
export type Effort = (typeof EFFORTS)[number]

export interface TaskConfig {
  model: ModelId
  effort: Effort
  /** 답이 끝없이 길어질 때를 막는 상한. 생각하기에 쓰는 토큰도 여기에 든다. 평소 답의 길이를 조절하는 값이 아니다. */
  maxTokens: number
  /** 'off'는 생각하기를 끌 수 있는 모델에서만 통한다. 끌 수 없는 모델에서는 무시한다. */
  thinking: 'on' | 'off'
  /** 시스템 프롬프트를 캐시에 올릴지. 몇 분 안에 같은 task를 이어서 부르는 경우에만 이득이다. */
  cacheSystem: boolean
  /**
   * 'fast'는 같은 모델이 글을 더 빨리 쓰게 한다(받는 모델에서만 통하고, 그 호출의 값이 두 배가 된다).
   * 돈이 더 드는 선택이라 기본값으로는 쓰지 않는다.
   */
  speed: 'standard' | 'fast'
}

/** 기본 모델. task별 기본값은 TASK_DEFAULTS에 있다. */
export const MODEL: ModelId = 'claude-opus-5-5'

/** 가장 싼 모델. 입력·출력 토큰 값이 Opus 5.5의 40분의 1이다. */
export const CHEAP_MODEL: ModelId = 'claude-haiku-5-5'
/** 사진에 쓰는 모델. 값은 Opus의 절반이고, 여러 반찬이 놓인 사진을 Haiku보다 잘 알아보도록 고른 중간 모델이다. */
export const PHOTO_MODEL: ModelId = 'claude-sonnet-5-5'

/**
 * task별 기본 설정. 모델·effort를 바꿀 때는 여기 한 곳만 고친다.
 *
 * 2026-11-19 주인 요청으로 비용을 가장 적게 쓰는 쪽으로 바꿨다: 모든 task가 Haiku 5.5, effort low, 생각하기 끔.
 * 사진(meal-photo)만은 가성비를 위해 Sonnet 5.5를 쓴다(생각하기 끔). 사진 한 장에 1센트 안팎이다.
 * 생각하기를 끄면 생각에 쓰는 출력 토큰이 없어진다. 대신 답의 질과 속도는 Opus보다 떨어질 수 있다.
 * Haiku는 서버 쪽 대체 모델(fallbacks)을 지원하지 않아, 거절하면 그대로 refused가 된다.
 * 시스템 프롬프트가 Haiku의 최소 캐시 크기보다 짧아 캐시는 쓰지 않는다.
 * 이전 설정(Opus 5.5 + fast mode)으로 돌리려면 환경변수 AI_MODEL_<TASK>=claude-opus-5-5, AI_SPEED_<TASK>=fast,
 * AI_THINKING_<TASK>=on 으로 코드를 고치지 않고 바꿀 수 있다(taskConfig).
 *
 * maxTokens는 생각하기 없이 쓰는 답의 길이(수백 토큰)에 여유를 둔 상한이다.
 */
export const TASK_DEFAULTS: Record<ModelTask, TaskConfig> = {
  'meal-text': { model: CHEAP_MODEL, effort: 'low', maxTokens: 2000, thinking: 'off', cacheSystem: false, speed: 'standard' },
  'meal-photo': { model: PHOTO_MODEL, effort: 'low', maxTokens: 2000, thinking: 'off', cacheSystem: false, speed: 'standard' },
  suggest: { model: CHEAP_MODEL, effort: 'low', maxTokens: 2000, thinking: 'off', cacheSystem: false, speed: 'standard' },
  'week-review': { model: CHEAP_MODEL, effort: 'low', maxTokens: 3000, thinking: 'off', cacheSystem: false, speed: 'standard' },
  ask: { model: CHEAP_MODEL, effort: 'low', maxTokens: 3000, thinking: 'off', cacheSystem: false, speed: 'standard' },
  nudge: { model: CHEAP_MODEL, effort: 'low', maxTokens: 2000, thinking: 'off', cacheSystem: false, speed: 'standard' },
}

/** task별 기본 effort. */
export const EFFORT = Object.fromEntries(Object.entries(TASK_DEFAULTS).map(([task, c]) => [task, c.effort])) as Record<ModelTask, Effort>

/** 모델이 답을 거절하면 서버가 다른 모델로 같은 요청을 이어서 처리하게 한다. */
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

/** 한 번의 시도에 주는 시간과, 재시도를 포함한 전체 시간(ms). 함수 제한 60초보다 넉넉히 짧게 둔다. */
export const ATTEMPT_TIMEOUT_MS = 40_000
export const TOTAL_TIMEOUT_MS = 50_000

const isModelId = (v: string): v is ModelId => Object.hasOwn(MODEL_RULES, v)
const isEffort = (v: string): v is Effort => (EFFORTS as readonly string[]).includes(v)

/** 'meal-text' → 'MEAL_TEXT'. 환경변수 이름의 뒷부분이다. */
export const envSuffix = (task: ModelTask): string => task.toUpperCase().replaceAll('-', '_')

/**
 * 이 task에 실제로 쓸 설정. 환경변수가 있으면 기본값 대신 그 값을 쓴다.
 *   AI_MODEL_<TASK>     예: AI_MODEL_MEAL_TEXT=claude-haiku-5-5
 *   AI_EFFORT_<TASK>    low | medium | high
 *   AI_THINKING_<TASK>  on | off
 *   AI_SPEED_<TASK>     standard | fast
 * 모르는 값은 무시하고 기본값을 쓴다. 실제로 쓴 모델과 effort는 호출 로그에 남는다.
 */
export function taskConfig(task: ModelTask, env: Record<string, string | undefined> = process.env): TaskConfig {
  const base = TASK_DEFAULTS[task]
  const suffix = envSuffix(task)
  const model = (env[`AI_MODEL_${suffix}`] ?? '').trim()
  const effort = (env[`AI_EFFORT_${suffix}`] ?? '').trim().toLowerCase()
  const thinking = (env[`AI_THINKING_${suffix}`] ?? '').trim().toLowerCase()
  const speed = (env[`AI_SPEED_${suffix}`] ?? '').trim().toLowerCase()
  return {
    ...base,
    model: isModelId(model) ? model : base.model,
    effort: isEffort(effort) ? effort : base.effort,
    thinking: thinking === 'on' || thinking === 'off' ? thinking : base.thinking,
    speed: speed === 'standard' || speed === 'fast' ? speed : base.speed,
  }
}

const SCHEMAS = {
  'meal-text': MealEstimateSchema,
  'meal-photo': MealEstimateSchema,
  'week-review': WeekReviewSchema,
  suggest: SuggestionsSchema,
  ask: AnswerSchema,
  nudge: NudgeSchema,
} as const

/** 쓰이는 중인 결과를 받는 함수. 매번 처음부터 지금까지의 전체가 온다. */
export type OnPartial = (partial: AiPartialMap[AiStreamTask]) => void

export interface CallModelArgs {
  request: ModelRequest
  userId: string
  /**
   * 주면, 조금씩 받을 수 있는 task(ask, week-review)는 쓰이는 대로 이 함수로 알려 준다.
   * 돌려주는 최종 결과는 주지 않았을 때와 같다. 실패로 끝나면 그동안 알려 준 것은 버려야 한다.
   */
  onPartial?: OnPartial
  /** 기다리던 쪽이 떠났을 때 호출을 그만두게 한다. */
  signal?: AbortSignal
}
export type ModelOutcome = { ok: true; result: ModelResultMap[ModelTask] } | { ok: false; error: AiErrorCode }
export type CallModel = (args: CallModelArgs) => Promise<ModelOutcome>

interface UsageLike {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

/** 테스트에서 가짜로 바꿔 끼우는 부분. 실제로는 client.beta.messages.parse다. */
type BetaMessages = Anthropic['beta']['messages']
export type ParseParams = Parameters<BetaMessages['parse']>[0]
export interface ParsedLike {
  stop_reason: string | null
  parsed_output: unknown
  model?: string
  usage?: UsageLike | null
}
export type ParseFn = (params: ParseParams, options: { signal: AbortSignal }) => Promise<ParsedLike>

/** 조금씩 받는 쪽. 실제로는 client.beta.messages.stream이다. */
export type StreamParams = Parameters<BetaMessages['stream']>[0]
export interface StreamEventLike {
  type: string
  delta?: unknown
}
export interface StreamedLike {
  stop_reason: string | null
  model?: string
  usage?: UsageLike | null
  content: readonly { type: string; text?: string }[]
}
export interface StreamLike extends AsyncIterable<StreamEventLike> {
  finalMessage(): Promise<StreamedLike>
}
export type StreamFn = (params: StreamParams, options: { signal: AbortSignal }) => StreamLike

function requestBody(request: ModelRequest, config: TaskConfig) {
  const { system, messages } = buildPrompt(request)
  const rules = MODEL_RULES[config.model]
  return {
    model: config.model,
    max_tokens: config.maxTokens,
    output_config: { effort: config.effort, format: betaZodOutputFormat(SCHEMAS[request.task]) },
    // thinking은 끌 때만 보낸다. 보내지 않으면 세 모델 모두 필요한 만큼 생각하고, 깊이는 effort로 조절한다.
    ...(config.thinking === 'off' && rules.thinkingOff ? { thinking: rules.thinkingOff } : {}),
    ...(rules.serverFallback ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
    ...(config.speed === 'fast' && rules.fastMode ? { speed: 'fast' as const } : {}),
    system: config.cacheSystem ? [{ type: 'text' as const, text: system, cache_control: { type: 'ephemeral' as const } }] : system,
    messages,
  }
}

export function buildParams(request: ModelRequest, config: TaskConfig = taskConfig(request.task)): ParseParams {
  return requestBody(request, config)
}

/**
 * 조금씩 받을 때 보내는 요청. 모델이 읽는 내용은 buildParams와 같다.
 * SDK가 응답을 스스로 해석하지 않게 형식에서 parse만 뺀다. 서버가 도중에 다른 모델로 넘기면 글이 여러 블록으로
 * 나뉘어 오는데, SDK는 첫 블록만 해석하려 들기 때문이다. 해석은 블록을 이어 붙여 여기서 한다.
 */
export function buildStreamParams(request: ModelRequest, config: TaskConfig = taskConfig(request.task)): StreamParams {
  const body = requestBody(request, config)
  const { type, schema } = body.output_config.format
  return { ...body, output_config: { effort: body.output_config.effort, format: { type, schema } } }
}

/** 스트림 안에서 온 오류 사건의 종류. 예: 'overloaded_error'. */
function streamErrorType(e: InstanceType<typeof Anthropic.APIError>): string | null {
  const body = e.error as { error?: { type?: unknown } } | undefined
  const type = body?.error?.type
  return typeof type === 'string' ? type : null
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
  // 조금씩 받는 도중에 온 오류에는 상태 코드가 없고 종류(type)만 있다.
  if (e instanceof Anthropic.APIError && e.status === undefined) {
    const type = streamErrorType(e)
    if (type === 'overloaded_error' || type === 'api_error' || type === 'timeout_error' || type === 'rate_limit_error') return 'busy'
    if (type === 'authentication_error' || type === 'permission_error') return 'not_configured'
  }
  // 전체 시간 제한(AbortSignal.timeout)에 걸린 경우.
  if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) return 'busy'
  return 'failed'
}

const roundTo10 = (n: number): number => Math.max(0, Math.round(n / 10) * 10)

/** 스키마로 한 번 더 확인하고, 숫자와 이름을 계약에 맞게 다듬는다. 맞지 않으면 null. */
export function tidyResult(task: ModelTask, parsed: unknown): ModelResultMap[ModelTask] | null {
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
    case 'nudge': {
      const r = NudgeSchema.safeParse(parsed)
      return r.success && r.data.message.trim() ? { message: r.data.message.trim() } : null
    }
  }
}

const textDelta = (event: StreamEventLike): string | null => {
  if (event.type !== 'content_block_delta') return null
  const delta = event.delta as { type?: unknown; text?: unknown } | null | undefined
  return delta && delta.type === 'text_delta' && typeof delta.text === 'string' ? delta.text : null
}

/** 조금씩 받으며 쓰이는 대로 알리고, 끝나면 parse와 같은 모양으로 돌려준다. */
async function streamOnce(
  stream: StreamFn,
  request: ModelRequest & { task: AiStreamTask },
  config: TaskConfig,
  signal: AbortSignal,
  onPartial: OnPartial,
  mark: (what: 'firstEvent' | 'firstText') => void,
): Promise<ParsedLike> {
  const s = stream(buildStreamParams(request, config), { signal })
  let soFar = ''
  let shown = ''
  for await (const event of s) {
    mark('firstEvent')
    const piece = textDelta(event)
    if (piece === null) continue
    soFar += piece
    const partial = partialResult(request.task, soFar)
    if (!partial) continue
    const key = JSON.stringify(partial)
    if (key === shown) continue
    shown = key
    mark('firstText')
    onPartial(partial)
  }
  const message = await s.finalMessage()
  // 글 블록을 모두 이어 붙인 것이 응답이다(도중에 다른 모델로 넘어갔으면 블록이 둘 이상이다).
  const whole = message.content.map((b) => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('')
  let parsed_output: unknown = null
  try {
    parsed_output = JSON.parse(whole || soFar)
  } catch {
    parsed_output = null
  }
  return { stop_reason: message.stop_reason, parsed_output, model: message.model, usage: message.usage }
}

/**
 * parse 함수(와 stream 함수)를 받아 callModel을 만든다. 사용자의 글, 사진, 키는 로그에 남기지 않는다.
 * stream 함수가 없거나 onPartial을 주지 않으면 언제나 한 덩어리로 받는다.
 */
export function createCallModel(parse: ParseFn, stream?: StreamFn, env: Record<string, string | undefined> = process.env): CallModel {
  return async ({ request, userId, onPartial, signal: outer }) => {
    const task = request.task
    const config = taskConfig(task, env)
    const started = Date.now()
    const streamed = Boolean(stream && onPartial && isAiStreamTask(task))
    const base = { evt: 'ai', task, user: userId, model: config.model, effort: config.effort, ...(config.speed === 'fast' ? { speed: 'fast' } : {}), streamed }
    const marks: { firstEvent?: number; firstText?: number } = {}
    const mark = (what: 'firstEvent' | 'firstText'): void => {
      marks[what] ??= Date.now() - started
    }
    try {
      const timeout = AbortSignal.timeout(TOTAL_TIMEOUT_MS)
      const signal = outer ? AbortSignal.any([timeout, outer]) : timeout
      const message =
        stream && onPartial && isAiStreamTask(task)
          ? await streamOnce(stream, request as ModelRequest & { task: AiStreamTask }, config, signal, onPartial, mark)
          : await parse(buildParams(request, config), { signal })
      const log = {
        ...base,
        ms: Date.now() - started,
        // 조금씩 받았을 때: 첫 조각이 온 시간과, 화면에 보일 첫 글자가 나온 시간.
        ...(streamed ? { firstEventMs: marks.firstEvent ?? null, firstTextMs: marks.firstText ?? null } : {}),
        servedBy: message.model ?? config.model,
        stop: message.stop_reason,
        in: message.usage?.input_tokens ?? null,
        out: message.usage?.output_tokens ?? null,
        cacheRead: message.usage?.cache_read_input_tokens ?? null,
        cacheWrite: message.usage?.cache_creation_input_tokens ?? null,
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

/** 실제 SDK로 부르는 callModel. 클라이언트는 함수 인스턴스마다 한 번만 만들어 호출 사이에 연결을 다시 쓴다. */
export function anthropicCallModel(): CallModel {
  return (args) => {
    if (!cached) {
      // ANTHROPIC_API_KEY는 SDK가 환경변수에서 읽는다.
      const client = new Anthropic({ maxRetries: 1, timeout: ATTEMPT_TIMEOUT_MS })
      cached = createCallModel(
        (params, options) => client.beta.messages.parse(params, options),
        (params, options) => client.beta.messages.stream(params, options),
      )
    }
    return cached(args)
  }
}
