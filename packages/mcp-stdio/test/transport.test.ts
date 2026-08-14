/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { afterEach, describe, expect, it } from 'vitest'
import { buildRemoteArgs, parseCli, PROTOCOL_VERSION } from '../src/contract.js'
import { resolveMcpRemoteEntry } from '../src/runner.js'

interface CapturedRequest {
  method: string
  rpcMethod?: string
  protocolHeader?: string
  protocolHeaderCount: number
}

const children: ChildProcessWithoutNullStreams[] = []
const temporaryDirectories: string[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function strictServer(): Promise<{
  endpoint: string
  requests: CapturedRequest[]
  close: () => Promise<void>
}> {
  const requests: CapturedRequest[] = []
  const server = http.createServer(async (request, response) => {
    if (request.method === 'GET') {
      response.writeHead(request.url === '/mcp' ? 405 : 404)
      response.end()
      return
    }
    if (request.method !== 'POST' || request.url !== '/mcp') {
      response.writeHead(404); response.end(); return
    }
    const body = await readJson(request)
    const rpcMethod = typeof body.method === 'string' ? body.method : undefined
    const protocolHeader = request.headers['mcp-protocol-version']
    requests.push({
      method: request.method,
      protocolHeaderCount: request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'mcp-protocol-version').length,
      ...(rpcMethod === undefined ? {} : { rpcMethod }),
      ...(protocolHeader === undefined ? {} : { protocolHeader: String(protocolHeader) }),
    })
    if (rpcMethod === 'initialize') {
      json(response, 200, {
        jsonrpc: '2.0', id: body.id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'strict-native-fixture', version: '1.0.0' },
        },
      })
      return
    }
    if (protocolHeader !== PROTOCOL_VERSION) {
      json(response, 400, {
        jsonrpc: '2.0', id: body.id ?? null,
        error: { code: -32600, message: 'missing or duplicate protocol header' },
      })
      return
    }
    if (rpcMethod === 'notifications/initialized') {
      response.writeHead(202); response.end(); return
    }
    if (rpcMethod === 'tools/list') {
      json(response, 200, { jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'fixture_tool', inputSchema: { type: 'object' } }] } })
      return
    }
    if (rpcMethod === 'tools/call') {
      json(response, 200, { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'fixture-ok' }] } })
      return
    }
    json(response, 404, { jsonrpc: '2.0', id: body.id ?? null, error: { code: -32601, message: 'not found' } })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture did not bind TCP')
  return {
    endpoint: `http://127.0.0.1:${address.port}/mcp`,
    requests,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

interface ProxyHarness {
  child: ChildProcessWithoutNullStreams
  stderr: string[]
  invalidStdoutLines: string[]
  send: (message: unknown) => void
  waitMessage: (predicate: (message: Record<string, unknown>) => boolean) => Promise<Record<string, unknown>>
  waitStderr: (fragment: string) => Promise<void>
}

async function launch(args: string[]): Promise<ProxyHarness> {
  const state = await mkdtemp(path.join(os.tmpdir(), 'native-mcp-transport-'))
  temporaryDirectories.push(state)
  const child = spawn(process.execPath, [resolveMcpRemoteEntry('proxy'), ...args], {
    env: { ...process.env, MCP_REMOTE_CONFIG_DIR: state },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.push(child)
  const stderr: string[] = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => stderr.push(chunk))
  const messages: Record<string, unknown>[] = []
  const invalidStdoutLines: string[] = []
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    try { messages.push(JSON.parse(line) as Record<string, unknown>) } catch { invalidStdoutLines.push(line) }
  })
  const waitUntil = async (predicate: () => boolean, label: string): Promise<void> => {
    const deadline = Date.now() + 10_000
    while (!predicate()) {
      if (child.exitCode !== null) throw new Error(`${label}: child exited ${child.exitCode}: ${stderr.join('')}`)
      if (Date.now() > deadline) throw new Error(`${label}: timed out: ${stderr.join('')}`)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  return {
    child,
    stderr,
    invalidStdoutLines,
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
    waitMessage: async (predicate) => {
      await waitUntil(() => messages.some(predicate), 'waiting for MCP message')
      return messages.find(predicate)!
    },
    waitStderr: (fragment) => waitUntil(() => stderr.join('').includes(fragment), `waiting for ${fragment}`),
  }
}

describe('pinned mcp-remote transport compatibility', () => {
  it('forwards initialize, initialized, tools/list, and tools/call with exactly one header', async () => {
    const fixture = await strictServer()
    try {
      const proxy = await launch(buildRemoteArgs(parseCli([]), fixture.endpoint))
      await proxy.waitStderr('Local STDIO server running')
      proxy.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } })
      expect((await proxy.waitMessage((message) => message.id === 1)).result).toBeDefined()
      proxy.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      proxy.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
      expect((await proxy.waitMessage((message) => message.id === 2)).result).toBeDefined()
      proxy.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fixture_tool', arguments: {} } })
      expect((await proxy.waitMessage((message) => message.id === 3)).result).toBeDefined()
      const postInitialize = fixture.requests.filter((request) => request.rpcMethod !== 'initialize')
      expect(postInitialize.map((request) => request.rpcMethod)).toEqual(expect.arrayContaining(['notifications/initialized', 'tools/list', 'tools/call']))
      expect(postInitialize.every((request) => request.protocolHeader === PROTOCOL_VERSION)).toBe(true)
      expect(postInitialize.every((request) => request.protocolHeaderCount === 1)).toBe(true)
      expect(postInitialize.every((request) => !request.protocolHeader?.includes(','))).toBe(true)
      expect(proxy.invalidStdoutLines).toEqual([])
    } finally {
      await fixture.close()
    }
  })

  it('keeps an unmodified exact-pin missing-header canary', async () => {
    const fixture = await strictServer()
    try {
      const args = buildRemoteArgs(parseCli([]), fixture.endpoint)
      const headerIndex = args.indexOf('--header')
      args.splice(headerIndex, 2)
      const proxy = await launch(args)
      await proxy.waitStderr('Local STDIO server running')
      proxy.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'fixture', version: '1' } } })
      await proxy.waitMessage((message) => message.id === 1)
      proxy.send({ jsonrpc: '2.0', method: 'notifications/initialized' })
      await proxy.waitStderr('missing or duplicate protocol header')
      const initialized = fixture.requests.filter((request) => request.rpcMethod === 'notifications/initialized')
      expect(initialized.some((request) => request.protocolHeader === undefined)).toBe(true)
    } finally {
      await fixture.close()
    }
  })

  it('rejects the title-case spelling because the warm-up header becomes duplicated', async () => {
    const fixture = await strictServer()
    try {
      const args = buildRemoteArgs(parseCli([]), fixture.endpoint)
      args[args.indexOf('mcp-protocol-version:2025-06-18')] = 'MCP-Protocol-Version:2025-06-18'
      const proxy = await launch(args)
      await proxy.waitStderr('missing or duplicate protocol header')
      expect(fixture.requests.some((request) => request.protocolHeader?.includes(','))).toBe(true)
    } finally {
      await fixture.close()
    }
  })
})
