// 코치가 먼저 건네는 아침·저녁 한마디. Vercel Cron이 부른다(vercel.json의 crons).
import { anthropicCallModel } from '../../server/ai/model.ts'
import { handleCoachCron } from '../../server/discord/coach.ts'

export const config = { maxDuration: 60 }

export async function GET(request: Request): Promise<Response> {
  try {
    return await handleCoachCron(request, {
      env: process.env,
      fetch: globalThis.fetch,
      callModel: anthropicCallModel(),
      now: () => new Date(),
    })
  } catch {
    console.log(JSON.stringify({ evt: 'coach', result: 'threw' }))
    return Response.json({ ok: false, error: 'failed' }, { status: 500 })
  }
}
