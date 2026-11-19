// AI 기능의 서버 함수. 로직은 server/ai에 있고 여기서는 실제 의존성만 연결한다.
import { handleAi, type AiDeps } from '../server/ai/handler.ts'
import { anthropicCallModel } from '../server/ai/model.ts'

export const config = { maxDuration: 60 }

// 함수 인스턴스가 살아 있는 동안 한 번만 만든다. Claude 클라이언트도 그 안에서 한 번만 만들어 연결을 다시 쓴다.
const deps: AiDeps = { env: process.env, fetch: (input, init) => globalThis.fetch(input, init), callModel: anthropicCallModel() }

export function GET(request: Request): Promise<Response> {
  return handleAi(request, deps)
}

// ask와 week-review는 화면이 `Accept: text/event-stream` 을 붙이면 본문을 조금씩 흘려보낸다(src/ai/contract.ts).
export function POST(request: Request): Promise<Response> {
  return handleAi(request, deps)
}
