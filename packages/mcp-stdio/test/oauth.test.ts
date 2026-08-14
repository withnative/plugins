/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdtemp, readdir, rm } from 'node:fs/promises'
import http, { type IncomingMessage, type ServerResponse } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildRemoteArgs, parseCli, PROTOCOL_VERSION } from '../src/contract.js'
import { resolveMcpRemoteEntry } from '../src/runner.js'

const children: ChildProcessWithoutNullStreams[] = []
const temporaryDirectories: string[] = []
afterEach(async () => {
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })))
})

async function body(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function json(response: ServerResponse, status: number, value: unknown, extra: http.OutgoingHttpHeaders = {}): void {
  response.writeHead(status, { 'content-type': 'application/json', ...extra })
  response.end(JSON.stringify(value))
}

interface OAuthFixture {
  endpoint: string
  registrations: number
  authorizations: number
  codeExchanges: number
  refreshes: number
  rejectAccessOne: boolean
  close: () => Promise<void>
}

async function oauthFixture(): Promise<OAuthFixture> {
  let origin = ''
  let challenge = ''
  let registrations = 0
  let authorizations = 0
  let codeExchanges = 0
  let refreshes = 0
  const fixture: OAuthFixture = {
    endpoint: '', registrations, authorizations, codeExchanges, refreshes, rejectAccessOne: false,
    close: async () => {},
  }
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', origin)
    if (request.method === 'GET' && requestUrl.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      json(response, 200, {
        resource: `${origin}/mcp`,
        authorization_servers: [origin],
        scopes_supported: ['openid', 'email', 'profile', 'offline_access'],
      })
      return
    }
    if (request.method === 'GET' && (requestUrl.pathname === '/.well-known/oauth-authorization-server' || requestUrl.pathname === '/.well-known/openid-configuration')) {
      json(response, 200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['openid', 'email', 'profile', 'offline_access'],
      })
      return
    }
    if (request.method === 'POST' && requestUrl.pathname === '/register') {
      registrations += 1; fixture.registrations = registrations
      const metadata = JSON.parse(await body(request)) as Record<string, unknown>
      json(response, 201, { ...metadata, client_id: 'fixture-client' })
      return
    }
    if (request.method === 'GET' && requestUrl.pathname === '/authorize') {
      authorizations += 1; fixture.authorizations = authorizations
      challenge = requestUrl.searchParams.get('code_challenge') ?? ''
      const redirect = new URL(requestUrl.searchParams.get('redirect_uri') ?? '')
      redirect.searchParams.set('code', 'fixture-code')
      redirect.searchParams.set('state', requestUrl.searchParams.get('state') ?? '')
      response.writeHead(302, { location: redirect.toString() })
      response.end()
      return
    }
    if (request.method === 'POST' && requestUrl.pathname === '/token') {
      const form = new URLSearchParams(await body(request))
      if (form.get('grant_type') === 'authorization_code') {
        codeExchanges += 1; fixture.codeExchanges = codeExchanges
        const verifier = form.get('code_verifier') ?? ''
        const derived = createHash('sha256').update(verifier).digest('base64url')
        if (form.get('code') !== 'fixture-code' || derived !== challenge) {
          json(response, 400, { error: 'invalid_grant' }); return
        }
        json(response, 200, {
          access_token: 'access-one', refresh_token: 'refresh-one', token_type: 'Bearer',
          expires_in: 300, scope: 'openid email profile offline_access',
        })
        return
      }
      if (form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === 'refresh-one') {
        refreshes += 1; fixture.refreshes = refreshes
        json(response, 200, {
          access_token: 'access-two', refresh_token: 'refresh-two', token_type: 'Bearer',
          expires_in: 300, scope: 'openid email profile offline_access',
        })
        return
      }
      json(response, 400, { error: 'invalid_grant' })
      return
    }
    if (requestUrl.pathname === '/mcp') {
      const authorization = request.headers.authorization
      const accepted = authorization === 'Bearer access-two' || (authorization === 'Bearer access-one' && !fixture.rejectAccessOne)
      if (!accepted) {
        json(response, 401, { error: 'unauthorized' }, {
          'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="openid email profile offline_access"`,
        })
        return
      }
      if (request.method === 'GET') { response.writeHead(405); response.end(); return }
      const message = JSON.parse(await body(request)) as Record<string, unknown>
      if (message.method === 'initialize') {
        json(response, 200, { jsonrpc: '2.0', id: message.id, result: { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'oauth-fixture', version: '1' } } })
      } else if (message.method === 'notifications/initialized') {
        response.writeHead(202); response.end()
      } else if (message.method === 'tools/list') {
        json(response, 200, { jsonrpc: '2.0', id: message.id, result: { tools: [] } })
      } else if (message.method === 'resources/list') {
        json(response, 200, { jsonrpc: '2.0', id: message.id, result: { resources: [] } })
      } else {
        json(response, 200, { jsonrpc: '2.0', id: message.id, result: {} })
      }
      return
    }
    response.writeHead(404); response.end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('OAuth fixture did not bind TCP')
  origin = `http://127.0.0.1:${address.port}`
  fixture.endpoint = `${origin}/mcp`
  fixture.close = () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return fixture
}

interface RunningProxy {
  child: ChildProcessWithoutNullStreams
  stderr: string[]
  waitStderr: (fragment: string) => Promise<void>
  stop: () => Promise<void>
}

async function launch(endpoint: string, state: string, port: number): Promise<RunningProxy> {
  const child = spawn(process.execPath, [
    resolveMcpRemoteEntry('proxy'),
    ...buildRemoteArgs(parseCli(['--callback-port', String(port), '--auth-timeout', '10']), endpoint),
  ], {
    env: { ...process.env, MCP_REMOTE_CONFIG_DIR: state },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  children.push(child)
  const stderr: string[] = []
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => stderr.push(chunk))
  const waitStderr = async (fragment: string): Promise<void> => {
    const deadline = Date.now() + 15_000
    while (!stderr.join('').includes(fragment)) {
      if (child.exitCode !== null) throw new Error(`child exited ${child.exitCode}: ${stderr.join('')}`)
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${fragment}: ${stderr.join('')}`)
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  return {
    child,
    stderr,
    waitStderr,
    stop: async () => {
      if (child.exitCode === null) child.kill('SIGINT')
      await new Promise<void>((resolve) => child.once('exit', () => resolve()))
    },
  }
}

async function unusedPort(): Promise<number> {
  const server = http.createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('port fixture failed')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

async function completeAuthorization(proxy: RunningProxy): Promise<void> {
  await proxy.waitStderr('Please authorize this client by visiting:')
  const match = proxy.stderr.join('').match(/Please authorize this client by visiting:\s*\n(http:\/\/[^\s]+)/)
  if (match?.[1] === undefined) throw new Error(`authorization URL not found: ${proxy.stderr.join('')}`)
  const authorization = await fetch(match[1], { redirect: 'manual' })
  expect(authorization.status).toBe(302)
  const callback = authorization.headers.get('location')
  if (callback === null) throw new Error('authorization response omitted its callback location')
  let response: Response | undefined
  const deadline = Date.now() + 2_000
  while (response === undefined) {
    try {
      response = await fetch(callback)
    } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
  expect(response.ok).toBe(true)
}

describe('OAuth state lifecycle', () => {
  it('uses S256 DCR once, reuses state, and refreshes without another browser login', async () => {
    const fixture = await oauthFixture()
    const state = await mkdtemp(path.join(os.tmpdir(), 'native-mcp-oauth-'))
    temporaryDirectories.push(state)
    const port = await unusedPort()
    try {
      const first = await launch(fixture.endpoint, state, port)
      await completeAuthorization(first)
      await first.waitStderr('Local STDIO server running')
      expect(fixture.registrations).toBe(1)
      expect(fixture.authorizations).toBe(1)
      expect(fixture.codeExchanges).toBe(1)
      await first.stop()

      const versionDirectories = await readdir(state)
      expect(versionDirectories).toHaveLength(1)
      const files = await readdir(path.join(state, versionDirectories[0]!))
      expect(files.some((file) => file.endsWith('_client_info.json'))).toBe(true)
      expect(files.some((file) => file.endsWith('_tokens.json'))).toBe(true)
      if (process.platform !== 'win32') {
        for (const file of files.filter((name) => name.endsWith('.json') || name.endsWith('.txt'))) {
          expect((await lstat(path.join(state, versionDirectories[0]!, file))).mode & 0o777).toBe(0o600)
        }
      }

      fixture.rejectAccessOne = true
      const second = await launch(fixture.endpoint, state, port)
      await second.waitStderr('Local STDIO server running')
      expect(second.stderr.join('')).not.toContain('Please authorize this client by visiting:')
      expect(fixture.registrations).toBe(1)
      expect(fixture.authorizations).toBe(1)
      expect(fixture.refreshes).toBe(1)
      await second.stop()
    } finally {
      await fixture.close()
    }
  })

  it('reuses one stored registration across concurrent ordinary starts', async () => {
    const fixture = await oauthFixture()
    const state = await mkdtemp(path.join(os.tmpdir(), 'native-mcp-oauth-concurrent-'))
    temporaryDirectories.push(state)
    const port = await unusedPort()
    try {
      const bootstrap = await launch(fixture.endpoint, state, port)
      await completeAuthorization(bootstrap)
      await bootstrap.waitStderr('Local STDIO server running')
      await bootstrap.stop()
      expect(fixture.registrations).toBe(1)
      expect(fixture.authorizations).toBe(1)
      expect(fixture.codeExchanges).toBe(1)

      const [first, second] = await Promise.all([
        launch(fixture.endpoint, state, port),
        launch(fixture.endpoint, state, port),
      ])
      await Promise.all([
        first.waitStderr('Local STDIO server running'),
        second.waitStderr('Local STDIO server running'),
      ])
      expect(first.stderr.join('')).not.toContain('Please authorize this client by visiting:')
      expect(second.stderr.join('')).not.toContain('Please authorize this client by visiting:')
      expect(fixture.registrations).toBe(1)
      expect(fixture.authorizations).toBe(1)
      expect(fixture.codeExchanges).toBe(1)
      await Promise.all([first.stop(), second.stop()])
    } finally {
      await fixture.close()
    }
  })
})
