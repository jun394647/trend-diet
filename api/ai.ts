// 자리만 잡아 둔 파일. 구현은 이어서 채운다.
import type { AiStatus } from '../src/ai/contract.ts'

export function GET(): Response {
  const status: AiStatus = { configured: Boolean(process.env.ANTHROPIC_API_KEY), dailyLimit: 0 }
  return Response.json(status)
}
