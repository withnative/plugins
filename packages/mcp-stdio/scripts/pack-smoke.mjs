/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await mkdtemp(path.join(os.tmpdir(), 'native-mcp-stdio-pack-'))
const activeChildren = new Set()
let fixtureServer

function command(program, args, cwd) {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  assert.equal(result.status, 0, `${program} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`)
  return result
}

function launch(program, args, cwd, env) {
  const child = spawn(program, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] })
  activeChildren.add(child)
  child.once('exit', () => activeChildren.delete(child))
  const output = { child, stdout: '', stderr: '' }
  child.stdout.setEncoding('utf8'); child.stdout.on('data', (chunk) => { output.stdout += chunk })
  child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk) => { output.stderr += chunk })
  return output
}

async function waitUntil(runtime, predicate, label, timeout = 15_000) {
  const deadline = Date.now() + timeout
  while (!predicate()) {
    if (runtime.child.exitCode !== null) throw new Error(`${label}: child exited ${runtime.child.exitCode}\n${runtime.stdout}\n${runtime.stderr}`)
    if (Date.now() > deadline) throw new Error(`${label}: timed out\n${runtime.stdout}\n${runtime.stderr}`)
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

async function waitExit(runtime, timeout = 15_000) {
  if (runtime.child.exitCode !== null) return { code: runtime.child.exitCode, signal: runtime.child.signalCode }
  return await Promise.race([
    new Promise((resolve) => runtime.child.once('exit', (code, signal) => resolve({ code, signal }))),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`child did not exit\n${runtime.stdout}\n${runtime.stderr}`)), timeout)),
  ])
}

function stdoutMessages(runtime) {
  return runtime.stdout.split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

async function strictFixture() {
  const requests = []
  let origin = ''
  let challenge = ''
  const server = http.createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? '/', origin)
    const send = (status, value, headers = {}) => {
      response.writeHead(status, { ...(value === undefined ? {} : { 'content-type': 'application/json' }), ...headers })
      response.end(value === undefined ? undefined : JSON.stringify(value))
    }
    if (request.method === 'GET' && requestUrl.pathname.startsWith('/.well-known/oauth-protected-resource')) {
      send(200, { resource: 'https://plugin.withnative.ai/mcp', authorization_servers: [origin], scopes_supported: ['openid', 'email', 'profile', 'offline_access'] })
      return
    }
    if (request.method === 'GET' && (requestUrl.pathname === '/.well-known/oauth-authorization-server' || requestUrl.pathname === '/.well-known/openid-configuration')) {
      send(200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        response_types_supported: ['code'],
        grant_types_supported: ['authorization_code', 'refresh_token'],
        token_endpoint_auth_methods_supported: ['none'],
        code_challenge_methods_supported: ['S256'],
      })
      return
    }
    if (request.method === 'POST' && requestUrl.pathname === '/register') {
      const chunks = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      send(201, { ...JSON.parse(Buffer.concat(chunks).toString('utf8')), client_id: 'packed-fixture-client' })
      return
    }
    if (request.method === 'GET' && requestUrl.pathname === '/authorize') {
      challenge = requestUrl.searchParams.get('code_challenge') ?? ''
      const redirect = new URL(requestUrl.searchParams.get('redirect_uri') ?? '')
      redirect.searchParams.set('code', 'packed-fixture-code')
      redirect.searchParams.set('state', requestUrl.searchParams.get('state') ?? '')
      response.writeHead(302, { location: redirect.toString() }); response.end(); return
    }
    if (request.method === 'POST' && requestUrl.pathname === '/token') {
      const chunks = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const form = new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
      const verifier = form.get('code_verifier') ?? ''
      const derived = createHash('sha256').update(verifier).digest('base64url')
      assert.equal(form.get('code'), 'packed-fixture-code')
      assert.equal(derived, challenge)
      send(200, { access_token: 'packed-access', refresh_token: 'packed-refresh', token_type: 'Bearer', expires_in: 300, scope: 'openid email profile offline_access' })
      return
    }
    if (requestUrl.pathname !== '/mcp') { response.writeHead(404); response.end(); return }
    if (request.headers.authorization !== 'Bearer packed-access') {
      send(401, { error: 'unauthorized' }, { 'www-authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="openid email profile offline_access"` })
      return
    }
    if (request.method === 'GET') { response.writeHead(405); response.end(); return }
    if (request.method !== 'POST') { response.writeHead(405); response.end(); return }
    const chunks = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    requests.push({
      method: message.method,
      header: request.headers['mcp-protocol-version'],
      count: request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'mcp-protocol-version').length,
    })
    if (message.method === 'initialize') send(200, { jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'packed-runtime-fixture', version: '1' } } })
    else if (message.method === 'notifications/initialized') send(202)
    else if (message.method === 'tools/list') send(200, { jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 'packed_fixture', inputSchema: { type: 'object' } }] } })
    else if (message.method === 'resources/list') send(200, { jsonrpc: '2.0', id: message.id, result: { resources: [] } })
    else if (message.method === 'tools/call') send(200, { jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: 'packed-ok' }] } })
    else send(404, { jsonrpc: '2.0', id: message.id ?? null, error: { code: -32601, message: 'not found' } })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert(address !== null && typeof address !== 'string')
  origin = `http://127.0.0.1:${address.port}`
  return { server, requests, endpoint: `${origin}/mcp` }
}

async function completeAuthorization(runtime) {
  await waitUntil(runtime, () => runtime.stderr.includes('Please authorize this client by visiting:'), 'installed auth authorization URL')
  const match = runtime.stderr.match(/Please authorize this client by visiting:\s*\n(http:\/\/[^\s]+)/)
  assert(match?.[1], `authorization URL missing\n${runtime.stderr}`)
  const authorization = await fetch(match[1], { redirect: 'manual' })
  assert.equal(authorization.status, 302)
  const callback = authorization.headers.get('location')
  assert(callback, 'authorization response omitted callback')
  const deadline = Date.now() + 2_000
  while (true) {
    try {
      const response = await fetch(callback)
      assert(response.ok)
      return
    } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

async function persistedAuthFiles(configDirectory) {
  const versions = await readdir(configDirectory, { withFileTypes: true })
  const version = versions.find((entry) => entry.isDirectory())
  assert(version, 'upstream auth version directory missing')
  const directory = path.join(configDirectory, version.name)
  const names = await readdir(directory)
  const client = names.find((name) => name.includes('client_info'))
  const tokens = names.find((name) => name.includes('tokens'))
  assert(client, 'persisted dynamic client registration missing')
  assert(tokens, 'persisted tokens missing')
  return [path.join(directory, client), path.join(directory, tokens)]
}

try {
  const packed = command('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], packageRoot)
  const report = JSON.parse(packed.stdout)[0]
  const files = report.files.map(({ path: file }) => file).sort()
  for (const required of ['LICENSE', 'README.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'dist/bin/mcp-stdio.js', 'dist/bin/mcp-stdio-auth.js']) {
    assert(files.includes(required), `packed artifact omitted ${required}`)
  }
  assert(files.every((file) => /^(dist\/|LICENSE$|README\.md$|THIRD_PARTY_NOTICES\.md$|package\.json$)/.test(file)), `unexpected packed files: ${files.join(', ')}`)
  assert(files.every((file) => !/(token|credential|secret|test\/|src\/)/i.test(file)), `sensitive or source-only path packed: ${files.join(', ')}`)

  const install = path.join(temporary, 'clean-install')
  await mkdir(install)
  await writeFile(path.join(install, 'package.json'), '{"private":true,"type":"module"}\n', { mode: 0o600 })
  command('npm', ['install', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', path.join(temporary, report.filename)], install)

  for (const executable of ['mcp-stdio', 'mcp-stdio-auth']) {
    const result = command(path.join(install, 'node_modules', '.bin', executable), ['--help'], install)
    assert.equal(result.stdout, '', `${executable} wrote non-MCP data to stdout`)
    assert.match(result.stderr, /Usage:/)
  }

  const adapterDist = path.join(install, 'node_modules', '@withnative', 'mcp-stdio', 'dist')
  const adapterText = [
    await readFile(path.join(adapterDist, 'contract.js'), 'utf8'),
    await readFile(path.join(adapterDist, 'runner.js'), 'utf8'),
    await readFile(path.join(adapterDist, 'state.js'), 'utf8'),
  ].join('\n')
  assert(!/(["'](?:access_token|refresh_token|client_secret)["']\s*:\s*["'][^"']+|BEGIN (?:RSA |EC )?PRIVATE KEY|Bearer [A-Za-z0-9._~-]{20,})/i.test(adapterText), 'packed adapter contains credential material')

  const dependencyRoot = path.join(install, 'node_modules', 'mcp-remote')
  const manifest = JSON.parse(await readFile(path.join(dependencyRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.version, '0.1.38')
  assert.match(await readFile(path.join(dependencyRoot, 'dist', 'chunk-65X3S4HB.js'), 'utf8'), /var version2 = "0\.1\.37"/)
  assert((await readFile(path.join(dependencyRoot, 'LICENSE'), 'utf8')).includes('MIT License'))

  const fixture = await strictFixture()
  fixtureServer = fixture.server
  const state = path.join(temporary, 'installed-runtime-state')
  const environmentRecord = path.join(temporary, 'runtime-environment.jsonl')
  const hook = path.join(temporary, 'redirect-fetch.mjs')
  await writeFile(hook, `
import { appendFileSync } from 'node:fs'
appendFileSync(process.env.NATIVE_PACK_ENV_RECORD, JSON.stringify({ argv: process.argv.slice(0, 3), config: process.env.MCP_REMOTE_CONFIG_DIR }) + '\\n')
const originalFetch = globalThis.fetch
globalThis.fetch = (input, init) => {
  const originalUrl = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
  if (originalUrl.origin !== 'https://plugin.withnative.ai') return originalFetch(input, init)
  const fixtureUrl = new URL(process.env.NATIVE_PACK_FIXTURE_ENDPOINT)
  fixtureUrl.pathname = originalUrl.pathname
  fixtureUrl.search = originalUrl.search
  return originalFetch(fixtureUrl, init)
}
`, { mode: 0o600 })
  const runtimeEnvironment = {
    ...process.env,
    NATIVE_MCP_STDIO_CONFIG_DIR: state,
    NATIVE_PACK_ENV_RECORD: environmentRecord,
    NATIVE_PACK_FIXTURE_ENDPOINT: fixture.endpoint,
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(hook).href}`.trim(),
    NO_COLOR: '1',
  }
  const binRoot = path.join(install, 'node_modules', '.bin')
  const expectedConfig = path.join(state, 'auth')

  const auth = launch(path.join(binRoot, 'mcp-stdio-auth'), [], install, runtimeEnvironment)
  await completeAuthorization(auth)
  await waitUntil(auth, () => auth.stderr.includes('Requesting tools list...') && auth.stderr.includes('Received message:'), 'installed auth diagnostic transport')
  const authFilesBeforeExit = await persistedAuthFiles(expectedConfig)
  const persistedClient = JSON.parse(await readFile(authFilesBeforeExit[0], 'utf8'))
  const persistedTokens = JSON.parse(await readFile(authFilesBeforeExit[1], 'utf8'))
  assert.equal(persistedClient.client_id, 'packed-fixture-client')
  assert.equal(persistedTokens.access_token, 'packed-access')
  assert.equal(persistedTokens.refresh_token, 'packed-refresh')
  if (process.platform !== 'win32') {
    for (const directory of [state, expectedConfig, path.dirname(authFilesBeforeExit[0])]) assert.equal((await lstat(directory)).mode & 0o777, 0o700)
    for (const file of authFilesBeforeExit) assert.equal((await lstat(file)).mode & 0o777, 0o600)
  }
  auth.child.kill('SIGINT')
  const authExit = await waitExit(auth)
  assert.deepEqual(authExit, { code: 0, signal: null }, `installed auth bin did not complete the documented Ctrl-C cleanup\n${auth.stdout}\n${auth.stderr}`)
  assert.equal(auth.stdout, '', 'installed auth bin wrote diagnostics to stdout')
  assert.match(auth.stderr, /Connected successfully!/)
  assert.match(auth.stderr, /Requesting tools list/)
  if (process.platform !== 'win32') {
    for (const file of await persistedAuthFiles(expectedConfig)) assert.equal((await lstat(file)).mode & 0o777, 0o600)
  }

  const proxy = launch(path.join(binRoot, 'mcp-stdio'), [], install, runtimeEnvironment)
  await waitUntil(proxy, () => proxy.stderr.includes('Local STDIO server running'), 'installed stdio wrapper startup')
  proxy.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'packed-smoke', version: '1' } } })}\n`)
  await waitUntil(proxy, () => stdoutMessages(proxy).some((message) => message.id === 1), 'packed initialize')
  proxy.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`)
  proxy.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`)
  proxy.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'packed_fixture', arguments: {} } })}\n`)
  await waitUntil(proxy, () => stdoutMessages(proxy).some((message) => message.id === 3), 'packed tool call')
  assert(stdoutMessages(proxy).every((message) => message.jsonrpc === '2.0'), 'installed stdio wrapper emitted a non-MCP stdout frame')
  proxy.child.kill('SIGTERM')
  const proxyExit = await waitExit(proxy)
  assert([0, 143].includes(proxyExit.code), `installed wrapper did not supervise SIGTERM cleanly: ${JSON.stringify(proxyExit)}`)

  const environmentRecords = (await readFile(environmentRecord, 'utf8')).trim().split('\n').map(JSON.parse)
  for (const entry of ['proxy.js', 'client.js']) {
    assert(environmentRecords.some((record) => record.argv.some((argument) => argument.endsWith(`/mcp-remote/dist/${entry}`)) && record.config === expectedConfig), `installed wrapper did not spawn ${entry} with private state`)
  }
  for (const entry of ['mcp-stdio.js', 'mcp-stdio-auth.js']) {
    const binName = entry.slice(0, -3)
    assert(environmentRecords.some((record) => record.argv.some((argument) => argument.startsWith(install) && (argument.endsWith(`/@withnative/mcp-stdio/dist/bin/${entry}`) || argument.endsWith(`/.bin/${binName}`)))), `installed bin ${entry} did not execute: ${JSON.stringify(environmentRecords)}`)
  }
  assert(fixture.requests.some((request) => request.method === 'tools/call'))
  assert(fixture.requests.some((request) => request.method === 'tools/list'))
  assert(fixture.requests.every((request) => request.header === '2025-06-18' && request.count === 1))
  if (process.platform !== 'win32') {
    assert.equal((await lstat(state)).mode & 0o777, 0o700)
    assert.equal((await lstat(expectedConfig)).mode & 0o777, 0o700)
  }
} finally {
  for (const child of activeChildren) child.kill('SIGKILL')
  if (fixtureServer !== undefined) await new Promise((resolve) => fixtureServer.close(() => resolve()))
  await rm(temporary, { recursive: true, force: true })
}
