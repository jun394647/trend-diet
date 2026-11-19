import { create } from 'zustand'
import { onLocalChange } from '../storage'
import { useStore } from '../store'
import { getLastSyncedAt, linkAccount, syncOnce, type LinkChoice, type Remote } from './engine'
import { createRemote, supabase } from './supabase'

export type SyncStatus = 'idle' | 'syncing' | 'error'

export interface SyncState {
  /** 서버 설정이 들어 있는 빌드인지. false면 계정 기능을 숨긴다. */
  enabled: boolean
  /** 로그인 상태를 확인했는지. */
  ready: boolean
  email: string | null
  status: SyncStatus
  error: string | null
  lastSyncedAt: string | null
  /** 기기와 계정 양쪽에 기록이 있어 사용자의 선택을 기다리는 중이면 건수를 담는다. */
  conflict: { localCount: number; remoteCount: number } | null

  start: () => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  /** 가입한다. 메일 확인이 필요하면 'confirm'을 돌려준다. */
  signUp: (email: string, password: string) => Promise<'signed-in' | 'confirm'>
  /** 구글 로그인 화면으로 이동한다. 로그인하면 이 앱으로 돌아오고, start()가 이어받는다. */
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  resolveConflict: (choice: LinkChoice) => Promise<void>
  syncNow: () => Promise<void>
}

/** Supabase의 영어 오류를 사용자가 읽을 문장으로 바꾼다. */
export function authErrorMessage(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('invalid login credentials')) return '이메일 또는 비밀번호가 맞지 않아요.'
  if (m.includes('already registered')) return '이미 가입된 이메일이에요. 로그인해 주세요.'
  if (m.includes('email not confirmed')) return '메일로 보낸 확인 링크를 먼저 눌러 주세요.'
  if (m.includes('password') && (m.includes('6') || m.includes('weak') || m.includes('short')))
    return '비밀번호는 6자 이상으로 정해 주세요.'
  if (m.includes('invalid') && m.includes('email')) return '이메일 주소를 다시 확인해 주세요.'
  if (m.includes('rate limit') || m.includes('too many')) return '요청이 너무 잦아요. 잠시 뒤에 다시 해 주세요.'
  if (m.includes('fetch') || m.includes('network')) return '서버에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'
  return `요청을 처리하지 못했어요. (${message})`
}

let remote: Remote | null = null
let linked = false
let running: Promise<void> | null = null
let again = false
let timer: ReturnType<typeof setTimeout> | undefined
let started = false

export const useSync = create<SyncState>((set, get) => {
  /** 실제 동기화 한 번. 동시에 여러 번 부르면 끝난 뒤 한 번만 더 돈다. */
  async function run(): Promise<void> {
    if (!remote || !linked) return
    if (running) {
      again = true
      return running
    }
    set({ status: 'syncing', error: null })
    running = (async () => {
      try {
        do {
          again = false
          const { applied } = await syncOnce(remote!)
          if (applied > 0) await useStore.getState().init()
        } while (again)
        set({ status: 'idle', lastSyncedAt: await getLastSyncedAt() })
      } catch (e) {
        set({ status: 'error', error: authErrorMessage(e instanceof Error ? e.message : String(e)) })
      } finally {
        running = null
      }
    })()
    return running
  }

  /** 로그인된 계정에 이 기기를 연결하고 첫 동기화를 한다. */
  async function attach(userId: string, email: string | null, choice?: LinkChoice): Promise<void> {
    if (!supabase) return
    remote = createRemote(supabase, userId)
    set({ email, error: null })
    try {
      const result = await linkAccount(remote, userId, choice)
      if (result.status === 'conflict') {
        linked = false
        set({ conflict: { localCount: result.localCount, remoteCount: result.remoteCount } })
        return
      }
      linked = true
      set({ conflict: null })
      // 계정 기록으로 바꿨을 수 있으므로 화면 상태를 다시 읽는다.
      await useStore.getState().init()
      await run()
    } catch (e) {
      set({ status: 'error', error: authErrorMessage(e instanceof Error ? e.message : String(e)) })
    }
  }

  function detach() {
    remote = null
    linked = false
    set({ email: null, conflict: null, status: 'idle', error: null })
  }

  return {
    enabled: supabase !== null,
    ready: supabase === null,
    email: null,
    status: 'idle',
    error: null,
    lastSyncedAt: null,
    conflict: null,

    start: async () => {
      if (!supabase || started) return
      started = true
      const { data } = await supabase.auth.getSession()
      set({ lastSyncedAt: await getLastSyncedAt() })
      if (data.session) await attach(data.session.user.id, data.session.user.email ?? null)
      set({ ready: true })

      // 기록이 바뀌면 잠시 모았다가 올리고, 앱으로 돌아오거나 연결이 복구되면 받아 온다.
      onLocalChange(() => {
        clearTimeout(timer)
        timer = setTimeout(() => void run(), 1500)
      })
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void run()
      })
      window.addEventListener('online', () => void run())
    },

    signIn: async (email, password) => {
      if (!supabase) return
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw new Error(authErrorMessage(error.message))
      await attach(data.user.id, data.user.email ?? email)
    },

    signUp: async (email, password) => {
      if (!supabase) return 'confirm'
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) throw new Error(authErrorMessage(error.message))
      // 이미 가입된 주소면 Supabase는 오류 없이 identities가 빈 사용자를 돌려준다.
      if (data.user && data.user.identities?.length === 0) {
        throw new Error('이미 가입된 이메일이에요. 로그인해 주세요.')
      }
      if (!data.session || !data.user) return 'confirm'
      await attach(data.user.id, data.user.email ?? email)
      return 'signed-in'
    },

    signInWithGoogle: async () => {
      if (!supabase) return
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}${window.location.pathname}` },
      })
      if (error) throw new Error(authErrorMessage(error.message))
    },

    signOut: async () => {
      if (!supabase) return
      // 올리지 못한 변경이 있으면 먼저 올려 본다. 실패해도 기기에는 남아 있다.
      await run()
      await supabase.auth.signOut()
      detach()
    },

    resolveConflict: async (choice) => {
      if (!supabase) return
      const { data } = await supabase.auth.getUser()
      if (!data.user) return
      await attach(data.user.id, data.user.email ?? get().email, choice)
    },

    syncNow: run,
  }
})
