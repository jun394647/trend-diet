import { supabase } from '../sync/supabase'
import {
  AI_STREAM_MIME,
  isAiStreamTask,
  type AiErrorBody,
  type AiErrorCode,
  type AiPartialMap,
  type AiRequest,
  type AiResponse,
  type AiResultMap,
  type AiStatus,
  type AiStreamEvent,
  type AiStreamTask,
  type AiTask,
  type AiUsage,
} from './contract'

/** AI 호출이 실패했을 때 던진다. code로 사유를 구분하고, message는 사용자에게 그대로 보여 줄 수 있다. */
export class AiError extends Error {
  readonly code: AiErrorCode | 'offline'
  readonly usage?: AiUsage
  constructor(code: AiErrorCode | 'offline', usage?: AiUsage) {
    super(aiErrorMessage(code, usage))
    this.name = 'AiError'
    this.code = code
    this.usage = usage
  }
}

export function aiErrorMessage(code: AiErrorCode | 'offline', usage?: AiUsage): string {
  switch (code) {
    case 'not_configured':
      return 'AI 기능이 아직 준비되지 않았어요.'
    case 'unauthorized':
      return '로그인이 필요해요. 설정에서 로그인한 뒤 다시 해 주세요.'
    case 'forbidden':
      return '이 계정은 AI 기능을 쓸 수 없어요.'
    case 'limit':
      return `오늘 AI 횟수${usage ? `(${usage.limit}번)` : ''}를 다 썼어요. 내일 다시 쓸 수 있어요.`
    case 'bad_request':
      return '보낸 내용을 읽지 못했어요. 글을 줄이거나 다른 사진으로 다시 해 주세요.'
    case 'refused':
      return '이번에는 답을 받지 못했어요. 내용을 바꿔서 다시 해 주세요.'
    case 'busy':
      return '응답이 늦어져 받지 못했어요. 다시 해 볼 수 있어요.'
    case 'offline':
      return '인터넷에 연결되어 있지 않아요. 연결된 뒤에 다시 해 주세요.'
    case 'failed':
      return 'AI 응답을 받지 못했어요. 잠시 뒤에 다시 해 주세요.'
  }
}

const ENDPOINT = '/api/ai'

/**
 * 서버에 API 키가 들어 있는지 확인한다. 확인하지 못하면 준비되지 않은 것으로 본다.
 * 로그인해 있으면 토큰을 함께 보내, 오늘 이미 쓴 횟수(used)도 받아 온다.
 */
export async function fetchAiStatus(): Promise<AiStatus> {
  try {
    let token: string | undefined
    try {
      token = supabase ? (await supabase.auth.getSession()).data.session?.access_token : undefined
    } catch {
      token = undefined
    }
    const res = await fetch(ENDPOINT, { method: 'GET', ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}) })
    if (!res.ok) return { configured: false, dailyLimit: 0 }
    return (await res.json()) as AiStatus
  } catch {
    return { configured: false, dailyLimit: 0 }
  }
}

/** 쓰이는 중인 결과. 조금씩 받을 수 없는 task에는 오지 않는다. */
export type AiPartial<T extends AiTask> = T extends AiStreamTask ? AiPartialMap[T] : never

export interface CallAiOptions<T extends AiTask> {
  /**
   * 주면, 조금씩 받을 수 있는 task(ask, week-review)는 쓰이는 대로 이 함수로 알려 준다.
   * 매번 처음부터 지금까지의 전체가 오므로 앞의 것을 덮어쓰면 된다. 호출이 실패로 끝나면 그동안 받은 것은 버린다.
   * 서버가 조금씩 보내 주지 않으면(예전 서버, 그 밖의 task) 한 번도 불리지 않고 평소처럼 끝난다.
   */
  onPartial?: (partial: AiPartial<T>) => void
}

const offlineOrBusy = (): 'offline' | 'busy' => (typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'busy')

/** SSE 본문을 끝까지 읽는다. done이면 결과를 돌려주고, error이거나 끝맺지 못하고 끊기면 AiError를 던진다. */
async function readStream<T extends AiTask>(
  body: ReadableStream<Uint8Array>,
  onPartial: ((partial: AiPartial<T>) => void) | undefined,
): Promise<{ result: AiResultMap[T]; usage: AiUsage }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  /** 서버가 횟수를 쓴 뒤에 알려 준 사용량. 그 뒤에 끊겨도 화면이 남은 횟수를 맞게 고칠 수 있다. */
  let usage: AiUsage | undefined
  let last: Extract<AiStreamEvent<T>, { type: 'done' | 'error' }> | undefined

  const take = (line: string): void => {
    if (!line.startsWith('data:')) return
    let event: AiStreamEvent<T>
    try {
      event = JSON.parse(line.slice(5)) as AiStreamEvent<T>
    } catch {
      return
    }
    if (!event || typeof event !== 'object') return
    if (event.type === 'start') usage = event.usage
    else if (event.type === 'partial') onPartial?.(event.result as AiPartial<T>)
    else if (event.type === 'done' || event.type === 'error') last = event
  }

  try {
    while (!last) {
      const { done, value } = await reader.read()
      if (done) break
      buffered += decoder.decode(value, { stream: true })
      let cut: number
      while (!last && (cut = buffered.indexOf('\n')) >= 0) {
        take(buffered.slice(0, cut).trim())
        buffered = buffered.slice(cut + 1)
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new AiError(offlineOrBusy(), usage)
  } finally {
    void reader.cancel().catch(() => {})
  }

  if (!last) throw new AiError(offlineOrBusy(), usage)
  if (last.type === 'error') throw new AiError(last.error, last.usage ?? usage)
  return { result: last.result, usage: last.usage }
}

/** AI 기능을 호출한다. 실패하면 AiError를 던진다. options.onPartial을 주면 쓰이는 대로 받는다. */
export async function callAi<R extends AiRequest>(
  request: R,
  signal?: AbortSignal,
  options?: CallAiOptions<R['task']>,
): Promise<{ result: AiResultMap[R['task']]; usage: AiUsage }> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null
  if (!session) throw new AiError('unauthorized')

  const streaming = Boolean(options?.onPartial) && isAiStreamTask(request.task)
  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...(streaming ? { Accept: `${AI_STREAM_MIME}, application/json` } : {}),
      },
      body: JSON.stringify(request),
      signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new AiError(offlineOrBusy())
  }

  // 조금씩 보내 주는 응답일 때만 그렇게 읽는다. 확인 단계의 실패와 예전 서버의 응답은 평소의 JSON이다.
  if (streaming && res.ok && res.body && (res.headers.get('content-type') ?? '').toLowerCase().includes(AI_STREAM_MIME)) {
    return readStream<R['task']>(res.body, options?.onPartial)
  }

  let body: AiResponse<R['task']> | AiErrorBody | null = null
  try {
    body = (await res.json()) as AiResponse<R['task']> | AiErrorBody
  } catch {
    body = null
  }
  if (!body) throw new AiError(res.status === 504 ? 'busy' : 'failed')
  if (!body.ok) throw new AiError(body.error, body.usage)
  return { result: body.result, usage: body.usage }
}
