import { AiError, callAi, type AiPartial } from '../../ai/client'
import type { AiRequest, AiResultMap } from '../../ai/contract'
import { quotaLeft, useAi } from '../../ai/store'
import { today } from '../../lib/date'
import { useSync } from '../../sync/store'

/** 이 시간 안에 답이 오지 않으면 기다리기를 그만두고 '응답이 늦어요'로 알린다. */
export const AI_TIMEOUT_MS = 55_000

/**
 * 화면이 아니라 저장소에서 부르는 AI 호출 한 번.
 * 화면을 떠나도 취소되지 않으므로, 돈을 들여 받은 답이 버려지지 않는다.
 * 사용량은 여기서 고쳐 두고, 실패는 항상 AiError로 던진다.
 * 기다리는 사이에 계정이 바뀌었으면 답은 앞 계정의 것이다. 사용량과 사용 가능 여부를 새 계정에 적지 않고,
 * 받은 답도 버린다(AiError('failed')로 던진다).
 *
 * onPartial을 주면 조금씩 받을 수 있는 task(ask, week-review)는 쓰이는 대로 알려 준다(매번 지금까지의 전체).
 * 시간 초과로 그만둔 뒤나 계정이 바뀐 뒤에는 알리지 않는다. 호출이 실패로 끝나면 부른 쪽이 그동안 받은 것을 버려야 한다.
 */
export async function callAiOnce<R extends AiRequest>(
  request: R,
  onPartial?: (partial: AiPartial<R['task']>) => void,
): Promise<AiResultMap[R['task']]> {
  const email = useSync.getState().email
  const sameAccount = () => useSync.getState().email === email
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new AiError('busy'))
    }, AI_TIMEOUT_MS)
  })
  const guarded =
    onPartial &&
    ((partial: AiPartial<R['task']>) => {
      if (!controller.signal.aborted && sameAccount()) onPartial(partial)
    })
  try {
    // onPartial이 없을 때는 인자를 예전과 똑같이 넘긴다.
    const call = guarded ? callAi(request, controller.signal, { onPartial: guarded }) : callAi(request, controller.signal)
    const { result, usage } = await Promise.race([call, timeout])
    if (!sameAccount()) throw new AiError('failed')
    useAi.getState().setUsage(usage)
    return result
  } catch (e) {
    if (!sameAccount()) throw new AiError('failed')
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

/**
 * 저장소에 남겨 둘 실패인지. 오늘 횟수를 다 썼다는 실패는 횟수 안내가 이미 말해 주므로 남기지 않는다.
 * 서버가 사용량을 알려 주지 않아 횟수 안내가 나오지 않을 때만 그대로 남긴다.
 */
export function errorToKeep(error: AiError): AiError | null {
  if (error.code !== 'limit') return error
  const ai = useAi.getState()
  const known = ai.usageDate === null || ai.usageDate === today()
  return known && quotaLeft(ai.usage) === 0 ? null : error
}
