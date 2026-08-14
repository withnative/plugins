/*
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */
export const PACKAGE_NAME = '@withnative/mcp-stdio'
export const PACKAGE_VERSION = '0.1.0'
export const REMOTE_URL = 'https://plugin.withnative.ai/mcp'
export const PROTOCOL_VERSION = '2025-06-18'
export const PROTOCOL_HEADER = `mcp-protocol-version:${PROTOCOL_VERSION}`

export const OAUTH_CLIENT_METADATA = Object.freeze({
  application_type: 'native',
  client_name: 'Native MCP stdio adapter',
  client_uri: 'https://github.com/withnative/plugins/tree/main/packages/mcp-stdio',
  software_id: PACKAGE_NAME,
  software_version: PACKAGE_VERSION,
  token_endpoint_auth_method: 'none',
  grant_types: ['authorization_code', 'refresh_token'],
  response_types: ['code'],
  scope: 'openid email profile offline_access',
})

export type AdapterMode = 'proxy' | 'auth'
export interface CliOptions {
  callbackPort?: number
  authTimeoutSeconds?: number
  debug: boolean
  help: boolean
  version: boolean
}
export class CliUsageError extends Error {}

function parseInteger(value: string | undefined, label: string, minimum: number, maximum: number): number {
  if (value === undefined || !/^\d+$/.test(value)) {
    throw new CliUsageError(`${label} requires an integer from ${minimum} to ${maximum}`)
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new CliUsageError(`${label} requires an integer from ${minimum} to ${maximum}`)
  }
  return parsed
}

export function parseCli(argv: readonly string[]): CliOptions {
  const options: CliOptions = { debug: false, help: false, version: false }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    switch (argument) {
      case '--callback-port':
        options.callbackPort = parseInteger(argv[++index], '--callback-port', 1024, 65535)
        break
      case '--auth-timeout':
        options.authTimeoutSeconds = parseInteger(argv[++index], '--auth-timeout', 1, 3600)
        break
      case '--debug':
        options.debug = true
        break
      case '--help':
      case '-h':
        options.help = true
        break
      case '--version':
      case '-v':
        options.version = true
        break
      default:
        throw new CliUsageError(`unsupported argument at position ${index + 1}`)
    }
  }
  return options
}

export function buildRemoteArgs(options: CliOptions, endpoint: string = REMOTE_URL): string[] {
  const args = [endpoint]
  if (options.callbackPort !== undefined) args.push(String(options.callbackPort))
  args.push(
    '--transport', 'http-only',
    '--host', '127.0.0.1',
    '--resource', endpoint,
    '--header', PROTOCOL_HEADER,
    '--static-oauth-client-metadata', JSON.stringify(OAUTH_CLIENT_METADATA),
  )
  if (options.authTimeoutSeconds !== undefined) args.push('--auth-timeout', String(options.authTimeoutSeconds))
  if (options.debug) args.push('--debug')
  return args
}

export function usage(mode: AdapterMode): string {
  const executable = mode === 'proxy' ? 'mcp-stdio' : 'mcp-stdio-auth'
  return [
    `${executable} ${PACKAGE_VERSION}`,
    '',
    `Usage: ${executable} [--callback-port PORT] [--auth-timeout SECONDS] [--debug]`,
    '',
    'Connects only to https://plugin.withnative.ai/mcp.',
    'Diagnostics are written to stderr; stdout is reserved for MCP frames.',
  ].join('\n')
}
