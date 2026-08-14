/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { chmod, lstat, mkdir, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface StatePaths { root: string; upstream: string }

function pathComponents(absolutePath: string): string[] {
  const resolved = path.resolve(absolutePath)
  const parsed = path.parse(resolved)
  const components = [parsed.root]
  let current = parsed.root
  for (const component of resolved.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component)
    components.push(current)
  }
  return components
}

function requireNarrowRoot(candidate: string, home: string = os.homedir()): string {
  const resolved = path.resolve(candidate)
  const components = pathComponents(resolved)
  const broadRoots = [path.parse(resolved).root, home, os.tmpdir(), process.cwd()].map((value) => path.resolve(value))
  if (components.length < 3 || broadRoots.includes(resolved)) {
    throw new Error('Native authentication state path is an unsafe broad directory')
  }
  return resolved
}

async function rejectUnsafeComponents(candidate: string, requireLeaf: boolean): Promise<void> {
  const resolved = path.resolve(candidate)
  let missing = false
  for (const component of pathComponents(resolved)) {
    let entry
    try {
      entry = await lstat(component)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') { missing = true; continue }
      throw error
    }
    if (missing) throw new Error(`Native authentication state path changed while it was being prepared: ${component}`)
    if (entry.isSymbolicLink()) throw new Error(`refusing symbolic link in Native authentication state path: ${component}`)
    if (!entry.isDirectory()) throw new Error(`Native authentication state path component is not a directory: ${component}`)
  }
  if (requireLeaf && missing) throw new Error('Native authentication state path disappeared while it was being prepared')
}

export function stateRoot(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  const override = environment.NATIVE_MCP_STDIO_CONFIG_DIR
  if (override !== undefined) {
    if (!path.isAbsolute(override)) throw new Error('NATIVE_MCP_STDIO_CONFIG_DIR must be an absolute path')
    return requireNarrowRoot(path.normalize(override), home)
  }
  if (platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'Native', 'mcp-stdio')
  if (platform === 'win32') {
    const localAppData = environment.LOCALAPPDATA
    return path.join(localAppData && path.isAbsolute(localAppData) ? localAppData : home, 'Native', 'mcp-stdio')
  }
  const xdg = environment.XDG_CONFIG_HOME
  return path.join(xdg && path.isAbsolute(xdg) ? xdg : path.join(home, '.config'), 'native', 'mcp-stdio')
}

async function hardenTree(directory: string): Promise<void> {
  await rejectUnsafeComponents(directory, true)
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    const current = await lstat(entryPath)
    if (current.isSymbolicLink()) throw new Error(`refusing symbolic link inside Native authentication state: ${entry.name}`)
    if (current.isDirectory()) {
      await chmod(entryPath, 0o700)
      await rejectUnsafeComponents(entryPath, true)
      await hardenTree(entryPath)
    } else if (current.isFile()) {
      await chmod(entryPath, 0o600)
      if ((await lstat(entryPath)).isSymbolicLink()) throw new Error(`authentication state changed during hardening: ${entry.name}`)
    }
  }
}

export async function prepareState(root: string = stateRoot()): Promise<StatePaths> {
  root = requireNarrowRoot(root)
  await rejectUnsafeComponents(root, false)
  await mkdir(root, { recursive: true, mode: 0o700 })
  await rejectUnsafeComponents(root, true)
  await chmod(root, 0o700)
  await rejectUnsafeComponents(root, true)
  const upstream = path.join(root, 'auth')
  await mkdir(upstream, { recursive: true, mode: 0o700 })
  await rejectUnsafeComponents(upstream, true)
  await chmod(upstream, 0o700)
  await rejectUnsafeComponents(upstream, true)
  await hardenTree(upstream)
  return { root, upstream }
}

export async function hardenState(paths: StatePaths): Promise<void> {
  requireNarrowRoot(paths.root)
  await rejectUnsafeComponents(paths.root, true)
  await rejectUnsafeComponents(paths.upstream, true)
  await chmod(paths.root, 0o700)
  await chmod(paths.upstream, 0o700)
  await rejectUnsafeComponents(paths.upstream, true)
  await hardenTree(paths.upstream)
}
