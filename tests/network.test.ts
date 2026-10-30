import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
const source = join(process.cwd(), 'src')
function files(dir: string): string[] { return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]) }
function forbidden(text: string) { return /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b|https?:\/\//.test(text) }
describe('no network', () => {
  it('blocks fetch and remote endpoints in application source', () => { for (const file of files(source)) expect(forbidden(readFileSync(file, 'utf8')), file).toBe(false) })
  it('actually catches an added fetch call', () => { expect(forbidden('const leak = fetch("/api")')).toBe(true) })
})
