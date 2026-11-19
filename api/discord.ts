// 디스코드 연동의 서버 함수. 로직은 server/discord에 있고 여기서는 실제 의존성만 연결한다.
//  - POST /api/discord          : 디스코드가 보내는 상호작용(슬래시 명령, 버튼)
//  - POST /api/discord?setup=1  : 명령 등록과 주소 연결(Authorization: Bearer CRON_SECRET)
import { waitUntil } from '@vercel/functions'
import { anthropicCallModel } from '../server/ai/model.ts'
import { handleInteraction } from '../server/discord/interactions.ts'
import { handleSetup } from '../server/discord/setup.ts'

export const config = { maxDuration: 60 }

export async function POST(request: Request): Promise<Response> {
  try {
    if (new URL(request.url).searchParams.get('setup') === '1') {
      return await handleSetup(request, { env: process.env, fetch: globalThis.fetch })
    }
    return await handleInteraction(request, {
      env: process.env,
      fetch: globalThis.fetch,
      callModel: anthropicCallModel(),
      now: () => new Date(),
      waitUntil,
    })
  } catch {
    console.log(JSON.stringify({ evt: 'discord', task: 'handler', result: 'threw' }))
    return Response.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}
