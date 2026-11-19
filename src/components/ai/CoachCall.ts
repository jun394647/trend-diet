import { AiError, callAi } from '../../ai/client'
import type { AiRequest, AiResultMap } from '../../ai/contract'
import { useAi } from '../../ai/store'

/** 이 시간 안에 답이 오지 않으면 기다리기를 그만두고 '응답이 늦어요'로 알린다. */
export const AI_TIMEOUT_MS = 55_000

/**
 * 화면이 아니라 저장소에서 부르는 AI 호출 한 번.
 * 화면을 떠나도 취소되지 않으므로, 돈을 들여 받은 답이 버려지지 않는다.
 * 사용량은 여기서 고쳐 두고, 실패는 항상 AiError로 던진다.
 */
export async function callAiOnce<R extends AiRequest>(request: R): Promise<AiResultMap[R['task']]> {
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new AiError('busy'))
    }, AI_TIMEOUT_MS)
  })
  try {
    const { result, usage } = await Promise.race([callAi(request, controller.signal), timeout])
    useAi.getState().setUsage(usage)
    return result
  } catch (e) {
    const error = e instanceof AiError ? e : new AiError('failed')
    if (error.usage) useAi.getState().setUsage(error.usage)
    if (error.code === 'forbidden') useAi.getState().setForbidden()
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** AiErrorNote가 '다시 시도' 버튼을 보여 주는 실패인지. 그때는 같은 일을 하는 다른 버튼을 감춘다. */
export function isRetryable(error: AiError): boolean {
  return error.code === 'busy' || error.code === 'failed' || error.code === 'offline'
}
