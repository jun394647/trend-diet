import { create } from 'zustand'
import type { AiError } from '../../ai/client'
import type { MealEstimate } from '../../ai/contract'
import type { AiCallState } from '../../ai/useAiCall'
import { today } from '../../lib/date'
import { useSync } from '../../sync/store'
import type { DateStr } from '../../types'
import { callAiOnce } from './CoachCall'

/** AI에 보내려고 줄여 둔 사진. previewUrl은 이 저장소가 맡아 두었다가 버릴 때 풀어 준다. */
export interface MealAiImage {
  base64: string
  mediaType: 'image/jpeg'
  previewUrl: string
}

type Call = AiCallState<MealEstimate>

export interface MealAiTextSlot {
  text: string
  call: Call
  /** 이 결과에서 이미 기록한 줄. */
  savedIds: number[]
  /** 기다리다 그만두고 화면을 떠났다. 요청은 계속되고, 답은 lastText에만 남긴다. */
  detached: boolean
}

export interface MealAiPhotoSlot {
  image: MealAiImage
  /** 사진과 함께 보낸 덧붙인 말. */
  note: string
  /** 사진을 고르거나 보낸 날. 날이 바뀌면 다시 보여 주지 않는다. */
  date: DateStr
  call: Call
  savedIds: number[]
}

/**
 * 식사 어림잡기의 요청과 결과.
 * 요청은 시트가 아니라 여기서 보내므로, 기다리다 취소하거나 시트를 닫아도 끊기지 않는다.
 * 서버는 받은 순간 횟수를 세기 때문에, 끊으면 값만 치르고 답을 잃는다.
 */
interface MealAiState {
  /** 지금(또는 마지막으로) 어림잡은 글. */
  text: MealAiTextSlot | null
  /** 마지막으로 고른 사진과 그 결과. 기록하거나 직접 버릴 때까지 남는다. */
  photo: MealAiPhotoSlot | null
  /** 마지막으로 받은 글 어림값. 같은 글을 다시 물으면 AI를 또 부르지 않고 이것을 보여 준다. */
  lastText: { text: string; data: MealEstimate } | null
}

const EMPTY: MealAiState = { text: null, photo: null, lastText: null }

export const useMealAi = create<MealAiState>(() => EMPTY)

/** 계정이 바뀌거나 비울 때마다 올린다. 그 전에 보낸 요청의 답은 버린다. */
let epoch = 0

function release(image: MealAiImage | undefined): void {
  if (image) URL.revokeObjectURL(image.previewUrl)
}

/** 기다리는 요청이 있어도 모두 비운다. 계정이 바뀌었을 때와 테스트에서 쓴다. */
export function resetMealAi(): void {
  epoch++
  release(useMealAi.getState().photo?.image)
  useMealAi.setState(EMPTY)
}

// 어림값은 그 계정의 횟수로 받은 것이다. 로그아웃하거나 계정이 바뀌면 남기지 않는다.
useSync.subscribe((s, prev) => {
  if (s.email !== prev.email) resetMealAi()
})

/**
 * 적은 글을 어림잡는다.
 *  - 앞서 보낸 글의 답을 기다리는 중이면 새로 보내지 않는다. 같은 글이면 그 요청을 이어서 본다.
 *  - 방금 같은 글로 받아 둔 어림값이 있으면 AI를 부르지 않고 그것을 보여 준다.
 */
export function requestMealText(text: string): void {
  const cur = useMealAi.getState()
  if (cur.text?.call.status === 'loading') {
    if (cur.text.text === text && cur.text.detached) useMealAi.setState({ text: { ...cur.text, detached: false } })
    return
  }
  if (cur.lastText?.text === text) {
    useMealAi.setState({ text: { text, call: { status: 'done', data: cur.lastText.data }, savedIds: [], detached: false } })
    return
  }
  const mine = epoch
  useMealAi.setState({ text: { text, call: { status: 'loading' }, savedIds: [], detached: false } })
  const settle = (call: Call) => {
    if (mine !== epoch) return
    useMealAi.setState((s) => {
      // 음식을 찾지 못한 답은 남기지 않는다. 같은 글로 한 번 더 해 볼 수 있어야 한다.
      const lastText = call.status === 'done' && call.data.items.length > 0 ? { text, data: call.data } : s.lastText
      const slot = s.text
      if (!slot || slot.text !== text || slot.call.status !== 'loading') return { lastText }
      // 화면을 떠난 요청의 답은 받아 두기만 한다. 다시 물으면 lastText에서 꺼낸다.
      return { lastText, text: slot.detached ? null : { ...slot, call } }
    })
  }
  void callAiOnce({ task: 'meal-text', text }).then(
    (data) => settle({ status: 'done', data }),
    (error: AiError) => settle({ status: 'error', error }),
  )
}

/** 글 어림잡기 화면을 떠난다. 기다리는 요청은 끊지 않고 끝까지 받는다. */
export function dismissMealText(): void {
  const slot = useMealAi.getState().text
  if (!slot) return
  useMealAi.setState({ text: slot.call.status === 'loading' ? { ...slot, detached: true } : null })
}

/** 고른 사진을 둔다. 아직 보내지 않는다. 앞서 둔 사진과 결과는 버린다. */
export function setMealPhoto(image: MealAiImage): void {
  release(useMealAi.getState().photo?.image)
  useMealAi.setState({ photo: { image, note: '', date: today(), call: { status: 'idle' }, savedIds: [] } })
}

/** 둔 사진을 어림잡는다. 이미 기다리는 중이면 아무 일도 하지 않는다. */
export function requestMealPhoto(note?: string): void {
  const slot = useMealAi.getState().photo
  if (!slot || slot.call.status === 'loading') return
  const mine = epoch
  const { image } = slot
  useMealAi.setState({ photo: { image, note: note ?? '', date: today(), call: { status: 'loading' }, savedIds: [] } })
  const settle = (call: Call) => {
    if (mine !== epoch) return
    useMealAi.setState((s) => (s.photo && s.photo.image === image ? { photo: { ...s.photo, call } } : {}))
  }
  void callAiOnce({ task: 'meal-photo', imageBase64: image.base64, mediaType: image.mediaType, ...(note ? { note } : {}) }).then(
    (data) => settle({ status: 'done', data }),
    (error: AiError) => settle({ status: 'error', error }),
  )
}

/** 사진과 그 결과를 버린다. */
export function discardMealPhoto(): void {
  const slot = useMealAi.getState().photo
  if (!slot) return
  release(slot.image)
  useMealAi.setState({ photo: null })
}

/** 결과에서 이미 기록한 줄을 적어 둔다. 일부만 저장된 뒤 다시 기록해도 두 번 들어가지 않는다. */
export function markMealAiSaved(kind: 'text' | 'photo', ids: readonly number[]): void {
  if (ids.length === 0) return
  useMealAi.setState((s) => {
    const slot = s[kind]
    return slot ? { [kind]: { ...slot, savedIds: [...slot.savedIds, ...ids] } } : {}
  })
}

/**
 * 시트를 닫았다 열어도 다시 보여 줄 만한 사진인지: 같은 날에 보냈고, 답을 기다리는 중이거나 음식을 찾은 결과가 있다.
 * 보내지 않은 사진, 실패한 요청, 음식을 찾지 못한 결과는 남길 것이 없다.
 */
export function isKeptPhoto(slot: MealAiPhotoSlot | null, day: DateStr = today()): slot is MealAiPhotoSlot {
  if (!slot || slot.date !== day) return false
  return slot.call.status === 'loading' || (slot.call.status === 'done' && slot.call.data.items.length > 0)
}
