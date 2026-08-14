/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { chmod, lstat, mkdir, readdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

export interface StatePaths { root: string; upstream: string }

export function stateRoot(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = os.homedir(),
): string {
  const override = environment.NATIVE_MCP_STDIO_CONFIG_DIR
  if (override !== undefined) {
    if (!path.isAbsolute(override)) throw new Error('NATIVE_MCP_STDIO_CONFIG_DIR must be an absolute path')
    return path.normalize(override)
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
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`refusing symbolic link inside Native authentication state: ${entry.name}`)
    if (entry.isDirectory()) {
      await chmod(entryPath, 0o700)
      await hardenTree(entryPath)
    } else if (entry.isFile()) {
      await chmod(entryPath, 0o600)
    }
  }
}

async function requireRealDirectory(directory: string, label: string): Promise<void> {
  const entry = await lstat(directory)
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`${label} is not a real directory`)
}

export async function prepareState(root: string = stateRoot()): Promise<StatePaths> {
  await mkdir(root, { recursive: true, mode: 0o700 })
  await requireRealDirectory(root, 'Native authentication state path')
  await chmod(root, 0o700)
  const upstream = path.join(root, 'auth')
  await mkdir(upstream, { recursive: true, mode: 0o700 })
  await requireRealDirectory(upstream, 'Native upstream authentication state path')
  await chmod(upstream, 0o700)
  await hardenTree(upstream)
  return { root, upstream }
}

export async function hardenState(paths: StatePaths): Promise<void> {
  await requireRealDirectory(paths.root, 'Native authentication state path')
  await requireRealDirectory(paths.upstream, 'Native upstream authentication state path')
  await chmod(paths.root, 0o700)
  await chmod(paths.upstream, 0o700)
  await hardenTree(paths.upstream)
}
