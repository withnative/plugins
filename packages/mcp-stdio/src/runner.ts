/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { buildRemoteArgs, CliUsageError, PACKAGE_NAME, PACKAGE_VERSION, parseCli, type AdapterMode, usage } from './contract.js'
import { hardenState, prepareState } from './state.js'

const require = createRequire(import.meta.url)

export function resolveMcpRemoteEntry(mode: AdapterMode): string {
  const manifest = require.resolve('mcp-remote/package.json')
  return path.join(path.dirname(manifest), 'dist', mode === 'proxy' ? 'proxy.js' : 'client.js')
}

export function exitCodeForSignal(signal: NodeJS.Signals | null): number {
  return signal === null ? 1 : 128 + (os.constants.signals[signal] ?? 0)
}

export function forwardSignal(child: ChildProcess, signal: NodeJS.Signals): boolean {
  if (child.exitCode !== null || child.signalCode !== null) return false
  return child.kill(signal)
}

export async function superviseChild(child: ChildProcess): Promise<number> {
  const handlers = new Map<NodeJS.Signals, () => void>()
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] satisfies NodeJS.Signals[]) {
    const handler = () => { forwardSignal(child, signal) }
    handlers.set(signal, handler)
    process.once(signal, handler)
  }
  try {
    return await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => resolve(code ?? exitCodeForSignal(signal)))
    })
  } finally {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler)
  }
}

const diagnostic = (message: string): void => { process.stderr.write(`${message}\n`) }

export async function run(mode: AdapterMode, argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  let options
  try {
    options = parseCli(argv)
  } catch (error) {
    diagnostic(`${PACKAGE_NAME}: ${error instanceof CliUsageError ? error.message : 'invalid arguments'}`)
    diagnostic(usage(mode))
    return 2
  }
  if (options.help) { diagnostic(usage(mode)); return 0 }
  if (options.version) { diagnostic(`${PACKAGE_NAME} ${PACKAGE_VERSION}`); return 0 }

  const previousUmask = process.umask(0o077)
  let paths
  try {
    paths = await prepareState()
    const child = spawn(process.execPath, [resolveMcpRemoteEntry(mode), ...buildRemoteArgs(options)], {
      env: { ...process.env, MCP_REMOTE_CONFIG_DIR: paths.upstream },
      stdio: 'inherit',
      windowsHide: true,
    })
    return await superviseChild(child)
  } catch (error) {
    diagnostic(`${PACKAGE_NAME}: ${error instanceof Error ? error.message : 'unable to start adapter'}`)
    return 1
  } finally {
    if (paths !== undefined) {
      try { await hardenState(paths) }
      catch (error) {
        diagnostic(`${PACKAGE_NAME}: could not harden authentication state: ${error instanceof Error ? error.message : 'unknown error'}`)
      }
    }
    process.umask(previousUmask)
  }
}
