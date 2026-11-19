/**
 * 처음 방문했을 때는 서비스 워커가 자리 잡기 전에 글꼴을 내려받기 때문에, 그 글꼴 조각들이 오프라인 저장소에 남지 않는다.
 * 화면이 이미 받은 글꼴 조각을 같은 저장소('fonts', vite.config.ts의 runtimeCaching과 같은 이름)에 넣어 둔다.
 * 이렇게 해 두면 설치 직후 인터넷 없이 열어도 한글이 같은 글꼴로 보인다.
 */
export const FONT_CACHE = 'fonts'

export async function warmFontCache(): Promise<number> {
  if (typeof caches === 'undefined' || typeof performance === 'undefined') return 0
  const urls = performance
    .getEntriesByType('resource')
    .map((entry) => entry.name)
    .filter((name) => {
      try {
        const url = new URL(name)
        return url.origin === location.origin && url.pathname.includes('/assets/') && url.pathname.endsWith('.woff2')
      } catch {
        return false
      }
    })
  if (urls.length === 0) return 0
  let added = 0
  try {
    const cache = await caches.open(FONT_CACHE)
    for (const url of new Set(urls)) {
      // 미리 받아 둔 묶음에 이미 있는 글꼴(라틴 숫자)은 건너뛴다.
      if ((await caches.match(url, { ignoreVary: true })) !== undefined) continue
      await cache.add(url)
      added++
    }
  } catch {
    // 저장 공간이 없거나 연결이 끊긴 경우. 다음에 열 때 다시 시도한다.
  }
  return added
}

/** 글꼴을 다 받았을 즈음에 한 번 실행한다. */
export function scheduleFontWarmup(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return
  const run = () => window.setTimeout(() => void warmFontCache(), 3000)
  if (document.readyState === 'complete') run()
  else window.addEventListener('load', run, { once: true })
}
