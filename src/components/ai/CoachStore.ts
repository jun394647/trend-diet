import { create } from 'zustand'
import type { AiError } from '../../ai/client'
import type { CoachContext } from '../../ai/contract'
import { useSync } from '../../sync/store'
import { callAiOnce } from './CoachCall'

export interface CoachMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
}

export const MAX_QUESTION = 500

interface CoachState {
  /** 이번 세션의 대화. 저장하지 않으므로 새로 고치면 사라진다. */
  messages: CoachMessage[]
  /** 적다 만 질문. 다른 화면에 다녀와도 남아 있다. */
  draft: string
  /** 답을 기다리는 중인지. 화면을 떠나도 요청은 계속되고, 답이 오면 대화에 들어간다. */
  pending: boolean
  /** 마지막 질문이 답을 받지 못한 이유. */
  error: AiError | null
  setDraft: (draft: string) => void
  /** 질문을 보낸다. 기다리는 중이면 아무 일도 하지 않는다. */
  send: (context: CoachContext, text: string) => void
  /** 답을 받지 못한 마지막 질문을 다시 보낸다. 질문을 대화에 또 넣지는 않는다. */
  retry: (context: CoachContext) => void
  /** 대화를 지운다. 답을 기다리는 중에는 지우지 않는다. */
  clear: () => void
}

let nextId = 1
/** 대화를 통째로 비울 때마다 올린다. 그 전에 보낸 요청의 답은 버린다. */
let epoch = 0

const EMPTY = { messages: [] as CoachMessage[], draft: '', pending: false, error: null }

export const useCoach = create<CoachState>((set, get) => {
  async function ask(context: CoachContext, question: string, prior: CoachMessage[]) {
    const mine = epoch
    set({ pending: true, error: null })
    try {
      const { answer } = await callAiOnce({ task: 'ask', context, question, history: toHistory(prior) })
      if (mine !== epoch) return
      set((s) => ({ pending: false, messages: [...s.messages, { id: nextId++, role: 'assistant', text: answer }] }))
    } catch (e) {
      if (mine !== epoch) return
      set({ pending: false, error: e as AiError })
    }
  }

  return {
    ...EMPTY,
    setDraft: (draft) => set({ draft: draft.slice(0, MAX_QUESTION) }),
    send: (context, text) => {
      const question = text.trim().slice(0, MAX_QUESTION)
      if (!question || get().pending) return
      const prior = get().messages
      set({ messages: [...prior, { id: nextId++, role: 'user', text: question }], draft: '' })
      void ask(context, question, prior)
    },
    retry: (context) => {
      const all = get().messages
      const q = all[all.length - 1]
      if (!q || q.role !== 'user' || get().pending) return
      void ask(context, q.text, all.slice(0, -1))
    },
    clear: () => {
      if (get().pending) return
      resetCoach()
    },
  }
})

/** 기다리는 요청이 있어도 대화를 비운다. 계정이 바뀌었을 때와 테스트에서 쓴다. */
export function resetCoach(): void {
  epoch++
  useCoach.setState(EMPTY)
}

// 대화에는 내 기록이 담겨 있다. 로그아웃하거나 계정이 바뀌면 남기지 않는다.
useSync.subscribe((s, prev) => {
  if (s.email !== prev.email) resetCoach()
})

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
