import { supabase } from '../sync/supabase'
import type { AiErrorBody, AiErrorCode, AiRequest, AiResponse, AiResultMap, AiStatus, AiUsage } from './contract'

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

/** AI 기능을 호출한다. 실패하면 AiError를 던진다. */
export async function callAi<R extends AiRequest>(
  request: R,
  signal?: AbortSignal,
): Promise<{ result: AiResultMap[R['task']]; usage: AiUsage }> {
  const session = supabase ? (await supabase.auth.getSession()).data.session : null
  if (!session) throw new AiError('unauthorized')

  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify(request),
      signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new AiError(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'busy')
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
