/**
 * 디스코드 REST 호출. Gateway 연결 없이 HTTP만 쓴다.
 * 어느 함수도 던지지 않고 결과를 돌려준다. 토큰이 들어가는 주소와 헤더는 로그에 남기지 않는다.
 */
export const DISCORD_API = 'https://discord.com/api/v10'
const TIMEOUT_MS = 8_000
/** 디스코드 메시지 한 건의 글자 수 제한. */
export const MESSAGE_LIMIT = 2000

export interface DiscordResult {
  ok: boolean
  /** HTTP 상태. 연결하지 못했으면 0. */
  status: number
  /** 디스코드가 돌려준 본문(JSON이면 풀어서). 실패했을 때 원인을 보여 주는 데 쓴다. */
  body: unknown
}

export interface MessagePayload {
  content: string
  components?: unknown[]
}

async function call(
  fetchFn: typeof fetch,
  method: string,
  path: string,
  options: { botToken?: string; body?: unknown } = {},
): Promise<DiscordResult> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'User-Agent': 'DiscordBot (https://discord.com, 1.0)' }
  if (options.botToken) headers.Authorization = `Bot ${options.botToken}`
  try {
    const res = await fetchFn(`${DISCORD_API}${path}`, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    const text = await res.text()
    let body: unknown = text
    try {
      body = text ? JSON.parse(text) : null
    } catch {
      body = text.slice(0, 500)
    }
    return { ok: res.ok, status: res.status, body }
  } catch {
    return { ok: false, status: 0, body: null }
  }
}

/** 멘션이 울리지 않게 하고, 버튼을 따로 주지 않으면 있던 버튼을 없앤다. */
function message(payload: MessagePayload) {
  return { content: payload.content, components: payload.components ?? [], allowed_mentions: { parse: [] } }
}

/** 미뤄 둔 응답(또는 버튼이 달린 원래 메시지)을 고친다. 상호작용 토큰만으로 되고 봇 토큰은 필요 없다. */
export function editOriginal(
  fetchFn: typeof fetch,
  applicationId: string,
  interactionToken: string,
  payload: MessagePayload,
): Promise<DiscordResult> {
  const path = `/webhooks/${encodeURIComponent(applicationId)}/${encodeURIComponent(interactionToken)}/messages/@original`
  return call(fetchFn, 'PATCH', path, { body: message(payload) })
}

/** 봇이 사용자에게 개인 메시지를 보낸다. DM 채널을 열고(이미 있으면 같은 채널이 온다) 거기에 쓴다. */
export async function sendDm(fetchFn: typeof fetch, botToken: string, userId: string, content: string): Promise<DiscordResult> {
  const channel = await call(fetchFn, 'POST', '/users/@me/channels', { botToken, body: { recipient_id: userId } })
  if (!channel.ok) return channel
  const id = (channel.body as { id?: unknown } | null)?.id
  if (typeof id !== 'string' || !id) return { ok: false, status: channel.status, body: channel.body }
  return call(fetchFn, 'POST', `/channels/${encodeURIComponent(id)}/messages`, { botToken, body: message({ content }) })
}

/** 전역 슬래시 명령을 통째로 바꿔 등록한다. 같은 내용으로 다시 불러도 결과가 같다. */
export function registerCommands(fetchFn: typeof fetch, botToken: string, applicationId: string, commands: unknown[]): Promise<DiscordResult> {
  return call(fetchFn, 'PUT', `/applications/${encodeURIComponent(applicationId)}/commands`, { botToken, body: commands })
}

/** 상호작용을 받을 주소를 정한다. 디스코드는 이때 그 주소로 PING을 보내 서명 확인이 되는지 본다. */
export function setInteractionsEndpoint(fetchFn: typeof fetch, botToken: string, url: string): Promise<DiscordResult> {
  return call(fetchFn, 'PATCH', '/applications/@me', { botToken, body: { interactions_endpoint_url: url } })
}
