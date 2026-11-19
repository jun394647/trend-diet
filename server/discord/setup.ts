/**
 * POST /api/discord?setup=1 : 한 번 불러 두는 연결 작업. CRON_SECRET으로 보호한다.
 * 슬래시 명령을 등록하고, 상호작용을 받을 주소를 이 서버로 정하고, 주인에게 확인 메시지를 보낸다.
 * 몇 번을 불러도 결과가 같다.
 */
import type { Env } from '../data/records.ts'
import { registerCommands, sendDm, setInteractionsEndpoint, type DiscordResult } from './api.ts'
import { COMMANDS } from './commands.ts'

const value = (s: string | undefined): string => (s ?? '').trim()

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/** Authorization: Bearer <CRON_SECRET> 인지 본다. 비밀값이 설정되지 않았으면 누구도 통과하지 못한다. */
export function hasCronSecret(request: Request, env: Env): boolean {
  const secret = value(env.CRON_SECRET)
  const given = /^Bearer\s+(\S+)$/i.exec(value(request.headers.get('authorization') ?? undefined))?.[1] ?? ''
  if (!secret || given.length !== secret.length) return false
  let diff = 0
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ given.charCodeAt(i)
  return diff === 0
}

export interface DiscordConfig {
  botToken: string
  applicationId: string
  ownerId: string
}

export function discordConfig(env: Env): DiscordConfig | null {
  const botToken = value(env.DISCORD_BOT_TOKEN)
  const applicationId = value(env.DISCORD_APPLICATION_ID)
  const ownerId = value(env.DISCORD_OWNER_ID)
  return botToken && applicationId && ownerId && value(env.DISCORD_PUBLIC_KEY) ? { botToken, applicationId, ownerId } : null
}

const step = (r: DiscordResult) => (r.ok ? { ok: true, status: r.status } : { ok: false, status: r.status, error: r.body })

export async function handleSetup(request: Request, deps: { env: Env; fetch: typeof fetch }): Promise<Response> {
  if (!hasCronSecret(request, deps.env)) return json({ ok: false, error: 'unauthorized' }, 401)
  const cfg = discordConfig(deps.env)
  if (!cfg) return json({ ok: false, error: 'not_configured' }, 503)

  const endpointUrl = `${new URL(request.url).origin}/api/discord`
  const commands = await registerCommands(deps.fetch, cfg.botToken, cfg.applicationId, COMMANDS)
  const endpoint = await setInteractionsEndpoint(deps.fetch, cfg.botToken, endpointUrl)
  const dm = await sendDm(deps.fetch, cfg.botToken, cfg.ownerId, '디스코드 연결이 끝났어요. /오늘 을 보내 보세요.')
  const ok = commands.ok && endpoint.ok && dm.ok
  console.log(JSON.stringify({ evt: 'discord', task: 'setup', commands: commands.status, endpoint: endpoint.status, dm: dm.status }))
  return json(
    { ok, commands: { ...step(commands), count: COMMANDS.length }, endpoint: { ...step(endpoint), url: endpointUrl }, dm: step(dm) },
    ok ? 200 : 502,
  )
}
