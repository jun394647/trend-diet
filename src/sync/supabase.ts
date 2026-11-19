import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Remote, RemoteRow } from './engine'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** 서버 설정이 없으면 null. 그때 앱은 기기 저장만으로 동작한다. */
// 구글 로그인에서 돌아올 때 토큰을 주소의 # 뒤가 아니라 ?code= 로 받는다(PKCE).
// 이 앱은 화면 이동에 # 를 쓰기 때문에 # 뒤로 받으면 서로 충돌한다.
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { flowType: 'pkce' } }) : null

const PAGE = 1000
const CHUNK = 500

export function createRemote(client: SupabaseClient, userId: string): Remote {
  return {
    async push(rows) {
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK).map((r) => ({
          user_id: userId,
          kind: r.kind,
          key: r.key,
          data: r.data,
          deleted: r.deleted,
        }))
        const { error } = await client.from('records').upsert(chunk, { onConflict: 'user_id,kind,key' })
        if (error) throw new Error(error.message)
      }
    },
    async pull(since) {
      const out: RemoteRow[] = []
      for (let from = 0; ; from += PAGE) {
        let q = client
          .from('records')
          .select('kind,key,data,deleted,updated_at')
          .order('updated_at')
          .order('kind')
          .order('key')
          .range(from, from + PAGE - 1)
        if (since) q = q.gte('updated_at', since)
        const { data, error } = await q
        if (error) throw new Error(error.message)
        out.push(...(data as RemoteRow[]))
        if (data.length < PAGE) return out
      }
    },
  }
}
