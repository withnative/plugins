/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import { chmod, lstat, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareState, stateRoot } from '../src/state.js'

const temporaryDirectories: string[] = []
afterEach(async () => { await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true }))) })
async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'native-mcp-stdio-'))
  temporaryDirectories.push(directory)
  return directory
}

describe('authentication state', () => {
  it('uses platform-specific Native-private locations', () => {
    expect(stateRoot({}, 'linux', '/home/alice')).toBe('/home/alice/.config/native/mcp-stdio')
    expect(stateRoot({ XDG_CONFIG_HOME: '/config' }, 'linux', '/home/alice')).toBe('/config/native/mcp-stdio')
    expect(stateRoot({}, 'darwin', '/Users/alice')).toBe('/Users/alice/Library/Application Support/Native/mcp-stdio')
    expect(stateRoot({ LOCALAPPDATA: 'C:\\Users\\alice\\AppData\\Local' }, 'win32', 'C:\\Users\\alice')).toContain('Native')
    expect(() => stateRoot({ NATIVE_MCP_STDIO_CONFIG_DIR: 'relative' }, 'linux', '/home/alice')).toThrow('absolute path')
    expect(() => stateRoot({ NATIVE_MCP_STDIO_CONFIG_DIR: '/' }, 'linux', '/home/alice')).toThrow('unsafe broad directory')
    expect(() => stateRoot({ NATIVE_MCP_STDIO_CONFIG_DIR: '/home/alice' }, 'linux', '/home/alice')).toThrow('unsafe broad directory')
  })

  it('is concurrency-safe and hardens directories and credential files', async () => {
    if (process.platform === 'win32') return
    const root = path.join(await temporaryDirectory(), 'state')
    const [first, second] = await Promise.all([prepareState(root), prepareState(root)])
    expect(first).toEqual(second)
    const versionDirectory = path.join(first.upstream, 'mcp-remote-0.1.37')
    await mkdir(versionDirectory, { mode: 0o755 })
    const token = path.join(versionDirectory, 'proof_tokens.json')
    await writeFile(token, '{"access_token":"redacted"}', { mode: 0o644 })
    await chmod(token, 0o644)
    await prepareState(root)
    expect((await lstat(root)).mode & 0o777).toBe(0o700)
    expect((await lstat(first.upstream)).mode & 0o777).toBe(0o700)
    expect((await lstat(versionDirectory)).mode & 0o777).toBe(0o700)
    expect((await lstat(token)).mode & 0o777).toBe(0o600)
  })

  it('refuses symlinks inside the credential tree', async () => {
    if (process.platform === 'win32') return
    const base = await temporaryDirectory()
    const paths = await prepareState(path.join(base, 'state'))
    const target = path.join(base, 'target')
    await writeFile(target, 'not credentials')
    await symlink(target, path.join(paths.upstream, 'tokens.json'))
    await expect(prepareState(paths.root)).rejects.toThrow('refusing symbolic link')
  })

  it('refuses a symlink in place of the upstream credential directory', async () => {
    if (process.platform === 'win32') return
    const base = await temporaryDirectory()
    const root = path.join(base, 'state')
    const target = path.join(base, 'target')
    await mkdir(root)
    await mkdir(target)
    await symlink(target, path.join(root, 'auth'))
    await expect(prepareState(root)).rejects.toThrow('refusing symbolic link')
  })

  it('rejects a symlink in any existing ancestor without creating through it', async () => {
    if (process.platform === 'win32') return
    const base = await temporaryDirectory()
    const target = path.join(base, 'target')
    const alias = path.join(base, 'alias')
    await mkdir(target)
    await symlink(target, alias)
    await expect(prepareState(path.join(alias, 'state'))).rejects.toThrow('refusing symbolic link')
    await expect(lstat(path.join(target, 'state'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects a non-directory ancestor and preserves it', async () => {
    const base = await temporaryDirectory()
    const file = path.join(base, 'ancestor')
    await writeFile(file, 'preserve me')
    await expect(prepareState(path.join(file, 'state'))).rejects.toThrow('not a directory')
    expect((await lstat(file)).isFile()).toBe(true)
  })

  it('rejects broad direct roots before attempting any chmod', async () => {
    await expect(prepareState(path.parse(process.cwd()).root)).rejects.toThrow('unsafe broad directory')
    await expect(prepareState(os.tmpdir())).rejects.toThrow('unsafe broad directory')
  })

  it('refuses to use a regular file as its state directory', async () => {
    const base = await temporaryDirectory()
    const file = path.join(base, 'not-a-directory')
    await writeFile(file, 'do not overwrite')
    await expect(prepareState(file)).rejects.toThrow()
    expect((await lstat(file)).isFile()).toBe(true)
  })
})
