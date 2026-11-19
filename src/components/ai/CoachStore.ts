import { create } from 'zustand'

export interface CoachMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
}

interface CoachState {
  /** 이번 세션의 대화. 저장하지 않으므로 새로 고치면 사라진다. */
  messages: CoachMessage[]
  add: (role: CoachMessage['role'], text: string) => void
  clear: () => void
}

let nextId = 1

export const useCoach = create<CoachState>((set) => ({
  messages: [],
  add: (role, text) => set((s) => ({ messages: [...s.messages, { id: nextId++, role, text }] })),
  clear: () => set({ messages: [] }),
}))

/** 서버가 받는 이전 대화의 최대 개수와 한 개의 최대 길이(contract.ts와 같다). */
const MAX_HISTORY = 20
const MAX_HISTORY_TEXT = 4000

/**
 * 이전 대화를 서버에 넘길 모양으로 바꾼다.
 * 답을 받지 못한 질문은 빼서 질문과 답이 번갈아 나오게 하고, 마지막 20개만 보낸다.
 */
export function toHistory(messages: CoachMessage[]): { role: 'user' | 'assistant'; text: string }[] {
  const out: { role: 'user' | 'assistant'; text: string }[] = []
  for (let i = 0; i < messages.length - 1; i++) {
    const q = messages[i]
    const a = messages[i + 1]
    if (q.role !== 'user' || a.role !== 'assistant') continue
    out.push(
      { role: 'user', text: q.text.slice(0, MAX_HISTORY_TEXT) },
      { role: 'assistant', text: a.text.slice(0, MAX_HISTORY_TEXT) },
    )
    i++
  }
  return out.slice(-MAX_HISTORY)
}
