/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const temporary = await mkdtemp(path.join(os.tmpdir(), 'native-mcp-stdio-pack-'))

function command(program, args, cwd) {
  const result = spawnSync(program, args, { cwd, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } })
  assert.equal(result.status, 0, `${program} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`)
  return result
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
} finally {
  await rm(temporary, { recursive: true, force: true })
}
