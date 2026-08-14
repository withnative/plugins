/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
  const server = http.createServer(async (request, response) => {
    if (request.method === 'GET') { response.writeHead(request.url === '/mcp' ? 405 : 404); response.end(); return }
    if (request.method !== 'POST' || request.url !== '/mcp') { response.writeHead(404); response.end(); return }
    const chunks = []
    for await (const chunk of request) chunks.push(Buffer.from(chunk))
    const message = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    requests.push({
      method: message.method,
      header: request.headers['mcp-protocol-version'],
      count: request.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === 'mcp-protocol-version').length,
    })
    const send = (status, value) => {
      response.writeHead(status, value === undefined ? {} : { 'content-type': 'application/json' })
      response.end(value === undefined ? undefined : JSON.stringify(value))
    }
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
  return { server, requests, endpoint: `http://127.0.0.1:${address.port}/mcp` }
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

  const auth = launch(path.join(binRoot, 'mcp-stdio-auth'), [], install, runtimeEnvironment)
  await waitUntil(auth, () => auth.stderr.includes('Requesting tools list...') && auth.stderr.includes('Received message:'), 'installed auth diagnostic transport')
  auth.child.kill('SIGTERM')
  const authExit = await waitExit(auth)
  assert.equal(authExit.code, 143, `installed auth bin did not propagate SIGTERM semantics\n${auth.stdout}\n${auth.stderr}`)
  assert.equal(auth.stdout, '', 'installed auth bin wrote diagnostics to stdout')
  assert.match(auth.stderr, /Connected successfully!/)
  assert.match(auth.stderr, /Requesting tools list/)

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
  const expectedConfig = path.join(state, 'auth')
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
