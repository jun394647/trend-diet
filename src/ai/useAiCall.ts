import { useCallback, useEffect, useRef, useState } from 'react'
import { AiError, callAi } from './client'
import type { AiRequest, AiResultMap } from './contract'
import { useSync } from '../sync/store'
import { useAi } from './store'

export type AiCallState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; data: T }
  | { status: 'error'; error: AiError }

/**
 * AI 호출 하나의 진행 상태를 관리한다.
 * run()을 다시 부르면 진행 중이던 호출은 취소되고, 화면이 사라질 때도 취소된다.
 */
export function useAiCall<R extends AiRequest>() {
  type Data = AiResultMap[R['task']]
  const [state, setState] = useState<AiCallState<Data>>({ status: 'idle' })
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => () => abortRef.current?.abort(), [])

  const run = useCallback(async (request: R): Promise<Data | null> => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setState({ status: 'loading' })
    // 사용량은 계정마다 다르다. 기다리는 사이에 계정이 바뀌면 받은 값을 새 계정에 쓰지 않는다.
    const email = useSync.getState().email
    const sameAccount = () => useSync.getState().email === email
    try {
      const { result, usage } = await callAi(request, controller.signal)
      if (controller.signal.aborted) return null
      if (!sameAccount()) {
        setState({ status: 'idle' })
        return null
      }
      useAi.getState().setUsage(usage)
      setState({ status: 'done', data: result })
      return result
    } catch (e) {
      if (controller.signal.aborted) return null
      const error = e instanceof AiError ? e : new AiError('failed')
      if (!sameAccount()) {
        setState({ status: 'idle' })
        return null
      }
      if (error.usage) useAi.getState().setUsage(error.usage)
      if (error.code === 'forbidden') useAi.getState().setForbidden()
      setState({ status: 'error', error })
      return null
    }
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    setState({ status: 'idle' })
  }, [])

  return { state, run, reset }
}
