import { useSync } from '../sync/store'
import { aiAvailability, useAi, type AiAvailability } from './store'

/** 화면에서 AI 기능을 보여 줄지, 로그인 안내를 보여 줄지 정할 때 쓴다. */
export function useAiAvailability(): AiAvailability {
  const configured = useAi((s) => s.configured)
  const signedIn = useSync((s) => s.email !== null && s.conflict === null)
  return aiAvailability(configured, signedIn)
}
