/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildRemoteArgs, OAUTH_CLIENT_METADATA, parseCli, PROTOCOL_HEADER, REMOTE_URL } from '../src/contract.js'
import { resolveMcpRemoteEntry } from '../src/runner.js'

describe('adapter contract', () => {
  it('builds the exact constrained upstream argument vector', () => {
    expect(buildRemoteArgs(parseCli(['--callback-port', '38191', '--auth-timeout', '90']))).toEqual([
      REMOTE_URL, '38191', '--transport', 'http-only', '--host', '127.0.0.1', '--resource', REMOTE_URL,
      '--header', 'mcp-protocol-version:2025-06-18', '--static-oauth-client-metadata',
      JSON.stringify(OAUTH_CLIENT_METADATA), '--auth-timeout', '90',
    ])
    expect(PROTOCOL_HEADER).toBe('mcp-protocol-version:2025-06-18')
  })

  it('rejects unknown, unsafe, or malformed options without echoing values', () => {
    expect(() => parseCli(['--callback-port', '1023'])).toThrow('1024 to 65535')
    expect(() => parseCli(['--auth-timeout', '3601'])).toThrow('1 to 3600')
    try { parseCli(['secret-value']) }
    catch (error) { expect(String(error)).not.toContain('secret-value') }
  })

  it('uses native public-client metadata and conservative scopes', () => {
    expect(OAUTH_CLIENT_METADATA).toMatchObject({
      application_type: 'native', token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      scope: 'openid email profile offline_access',
    })
  })

  it('pins the public package while acknowledging its bundled runtime identity', async () => {
    const proxyEntry = resolveMcpRemoteEntry('proxy')
    const manifest = JSON.parse(await readFile(path.resolve(proxyEntry, '..', '..', 'package.json'), 'utf8')) as { version: string }
    expect(manifest.version).toBe('0.1.38')
    expect(await readFile(path.join(path.dirname(proxyEntry), 'chunk-65X3S4HB.js'), 'utf8')).toContain('var version2 = "0.1.37"')
  })
})
