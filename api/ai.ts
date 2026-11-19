// AI 기능의 서버 함수. 로직은 server/ai에 있고 여기서는 실제 의존성만 연결한다.
import { handleAi, type AiDeps } from '../server/ai/handler.ts'
import { anthropicCallModel } from '../server/ai/model.ts'

export const config = { maxDuration: 60 }

const deps = (): AiDeps => ({ env: process.env, fetch: globalThis.fetch, callModel: anthropicCallModel() })

export function GET(request: Request): Promise<Response> {
  return handleAi(request, deps())
}

export async function POST(request: Request): Promise<Response> {
  return handleAi(request, deps())
}
