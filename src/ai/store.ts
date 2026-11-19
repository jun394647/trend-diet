import { create } from 'zustand'
import { fetchAiStatus } from './client'
import type { AiUsage } from './contract'

export interface AiState {
  /** 서버에 API 키가 들어 있어 AI 기능을 쓸 수 있는지. 확인 전에는 false. */
  configured: boolean
  checked: boolean
  /** 마지막 호출에서 서버가 알려 준 오늘 사용량. */
  usage: AiUsage | null
  check: () => Promise<void>
  setUsage: (usage: AiUsage) => void
}

export const useAi = create<AiState>((set, get) => ({
  configured: false,
  checked: false,
  usage: null,
  check: async () => {
    if (get().checked) return
    const status = await fetchAiStatus()
    set({ configured: status.configured, checked: true })
  },
  setUsage: (usage) => set({ usage }),
}))

/**
 * 지금 AI 기능을 쓸 수 있는 상태인지.
 *  - 'off': 서버에 준비되지 않았다. AI 관련 화면 요소를 아예 숨긴다.
 *  - 'login': 준비는 됐지만 로그인하지 않았다. 로그인하면 쓸 수 있다고 안내한다.
 *  - 'ready': 쓸 수 있다.
 */
export type AiAvailability = 'off' | 'login' | 'ready'

export function aiAvailability(configured: boolean, signedIn: boolean): AiAvailability {
  return !configured ? 'off' : signedIn ? 'ready' : 'login'
}
