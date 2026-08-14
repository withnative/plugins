/* This Source Code Form is subject to the terms of the Mozilla Public License, v. 2.0. */
import type { ChildProcess } from 'node:child_process'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exitCodeForSignal, forwardSignal, run } from '../src/runner.js'

afterEach(() => { vi.restoreAllMocks() })

describe('process boundary', () => {
  it('forwards termination only to a live child and preserves signal exit semantics', () => {
    const child = { exitCode: null, signalCode: null, kill: vi.fn(() => true) } as unknown as ChildProcess
    expect(forwardSignal(child, 'SIGTERM')).toBe(true)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(exitCodeForSignal('SIGTERM')).toBe(143)

    Object.assign(child, { exitCode: 0 })
    expect(forwardSignal(child, 'SIGINT')).toBe(false)
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('keeps usage and sanitized argument errors off stdout', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const secret = 'never-print-this-value'

    expect(await run('proxy', ['--unknown', secret])).toBe(2)
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr.mock.calls.flat().join('')).not.toContain(secret)

    stderr.mockClear()
    expect(await run('client', ['--help'])).toBe(0)
    expect(stdout).not.toHaveBeenCalled()
    expect(stderr.mock.calls.flat().join('')).toContain('mcp-stdio-auth')
  })
})
