// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { keypair } from './testkit.ts'
import { verifyDiscordSignature } from './verify.ts'

describe('verifyDiscordSignature', () => {
  it('실제로 만든 Ed25519 열쇠의 서명을 확인한다', async () => {
    const k = await keypair()
    const body = '{"type":1,"한글":"본문"}'
    const signature = await k.sign('1700000000', body)
    const ok = { publicKey: k.publicKey, signature, timestamp: '1700000000', body }
    expect(await verifyDiscordSignature(ok)).toBe(true)
    expect(await verifyDiscordSignature({ ...ok, signature: signature.toUpperCase() })).toBe(true)
    expect(await verifyDiscordSignature({ ...ok, body: `${body} ` })).toBe(false)
    expect(await verifyDiscordSignature({ ...ok, timestamp: '1700000001' })).toBe(false)
    expect(await verifyDiscordSignature({ ...ok, publicKey: (await keypair()).publicKey })).toBe(false)
  })

  it('헤더가 없거나 형식이 틀리면 던지지 않고 false', async () => {
    const k = await keypair()
    const signature = await k.sign('1', 'x')
    const ok = { publicKey: k.publicKey, signature, timestamp: '1', body: 'x' }
    expect(await verifyDiscordSignature({ ...ok, signature: null })).toBe(false)
    expect(await verifyDiscordSignature({ ...ok, timestamp: null })).toBe(false)
    expect(await verifyDiscordSignature({ ...ok, signature: '' })).toBe(false)
    expect(await verifyDiscordSignature({ ...ok, signature: 'not-hex' })).toBe(false)
    expect(await verifyDiscordSignature({ ...ok, signature: signature.slice(2) })).toBe(false)
    expect(await verifyDiscordSignature({ ...ok, publicKey: '' })).toBe(false)
    expect(await verifyDiscordSignature({ ...ok, publicKey: 'abcd' })).toBe(false)
  })
})
