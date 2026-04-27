/**
 * SSH transport helpers.
 *
 * Zero-footprint pattern: scripts piped via bash -s stdin.
 * No agent, no daemon, no installation on target machines.
 *
 * SSH ControlMaster is NOT used here — we use compound scripts
 * (see docs/ssh-batching.md) to reduce connection count instead.
 * That keeps the transport layer simple and stateless.
 */

import { execSync } from 'child_process'

export const SSH_OPTS = '-o ConnectTimeout=8 -o BatchMode=yes -o StrictHostKeyChecking=no'

export type SSHStatus = 'ok' | 'auth_failure' | 'unreachable'

export function sshStatus(host: string): SSHStatus {
  try {
    const result = execSync(`ssh ${SSH_OPTS} ${host} 'echo ok'`, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
    return result === 'ok' ? 'ok' : 'unreachable'
  } catch (err: any) {
    const output = [err.stderr, err.stdout, err.message]
      .filter(Boolean)
      .map((s: any) => s.toString())
      .join('\n')
    if (/Permission denied|publickey|authentication failed/i.test(output)) {
      return 'auth_failure'
    }
    return 'unreachable'
  }
}

/**
 * Run a bash script on a remote host via stdin pipe.
 * Returns empty string on any error — callers check for empty to detect silent failures.
 */
export function sshScript(host: string, script: string): string {
  try {
    return execSync(`ssh ${SSH_OPTS} ${host} 'bash -s'`, {
      input: script,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

/**
 * Parse key:value lines into a record. Lines without ':' are ignored.
 * Stops at known section markers (---).
 */
export function parseKV(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of (raw ?? '').split('\n').filter(Boolean)) {
    if (line.startsWith('---')) continue
    const idx = line.indexOf(':')
    if (idx === -1) continue
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return out
}
