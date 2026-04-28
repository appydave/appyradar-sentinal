/**
 * Bash script snapshot tests.
 *
 * Renders each script template and asserts the output contains the critical
 * flags and output markers required for correctness. No SSH needed.
 *
 * Pattern mirrors disk-usage/__tests__/bash-scripts.test.ts.
 */

import { describe, it, expect } from 'vitest'
import {
  systemSnapshotScript,
  toolsScript,
  appsPathScript,
  portsListScript,
  relayAndOMIScript,
  agentStateScript,
  angelEyeScript,
  gitReposScript,
} from '../collect/collectors/bash-scripts.js'
import type { AppEntry } from '../types.js'

// ─── systemSnapshotScript ─────────────────────────────────────────────────────

describe('systemSnapshotScript', () => {
  const script = systemSnapshotScript()

  it('emits --- identity --- section marker', () => {
    expect(script).toContain('--- identity ---')
  })

  it('emits --- system --- section marker', () => {
    expect(script).toContain('--- system ---')
  })

  it('emits --- disk --- section marker', () => {
    expect(script).toContain('--- disk ---')
  })

  it('collects hostname', () => {
    expect(script).toContain('hostname:')
    expect(script).toContain('hostname')
  })

  it('uses sw_vers for macOS version', () => {
    expect(script).toContain('sw_vers')
  })

  it('collects load averages', () => {
    expect(script).toContain('load_1m')
    expect(script).toContain('load_5m')
  })

  it('collects memory via top -l1', () => {
    expect(script).toContain('top -l1')
    expect(script).toContain('PhysMem')
  })

  it('uses sysctl kern.memorystatus_vm_pressure_level (authoritative macOS pressure)', () => {
    // Critical: fixes the false-alarm pressure bug from the original audit.ts
    expect(script).toContain('kern.memorystatus_vm_pressure_level')
    expect(script).toContain('memory_pressure_raw')
  })

  it('uses df -Pkl for disk (kilobytes, portable)', () => {
    expect(script).toContain('df -Pkl')
  })

  it('filters out macOS virtual volumes', () => {
    expect(script).toContain('System.Volumes.VM')
    expect(script).toContain('System.Volumes.Preboot')
    expect(script).toContain('devfs')
  })

  it('outputs disk in pipe-delimited format', () => {
    expect(script).toContain('printf')
    expect(script).toContain('\\n')
  })

  it('suppresses stderr with 2>/dev/null', () => {
    expect(script).toContain('2>/dev/null')
  })
})

// ─── toolsScript ──────────────────────────────────────────────────────────────

describe('toolsScript', () => {
  const script = toolsScript()

  it('checks ruby, node, bun, python3, git, brew, claude, tmux', () => {
    expect(script).toContain('ruby')
    expect(script).toContain('node')
    expect(script).toContain('bun')
    expect(script).toContain('python3')
    expect(script).toContain('git')
    expect(script).toContain('brew')
    expect(script).toContain('claude')
    expect(script).toContain('tmux')
  })

  it('has PATH fallback for bun (installs to ~/.bun/bin/bun)', () => {
    // Critical: bun is not in non-interactive SSH PATH
    expect(script).toContain('.bun/bin/bun')
  })

  it('has PATH fallback for tailscale (macOS GUI app)', () => {
    // Critical: tailscale null on all machines in original audit.ts
    expect(script).toContain('Tailscale.app')
  })

  it('has PATH fallback for docker (Docker Desktop symlink)', () => {
    // Critical: docker null on all machines in original audit.ts
    expect(script).toContain('/usr/local/bin/docker')
  })

  it('emits key:value pairs', () => {
    expect(script).toContain('echo "ruby:')
    expect(script).toContain('echo "bun:')
  })

  it('counts brew_outdated', () => {
    expect(script).toContain('brew_outdated')
    expect(script).toContain('brew outdated')
  })

  it('suppresses errors with 2>/dev/null', () => {
    expect(script).toContain('2>/dev/null')
  })
})

// ─── appsPathScript ───────────────────────────────────────────────────────────

describe('appsPathScript', () => {
  const apps: AppEntry[] = [
    { key: 'flihub', display: 'FliHub', path: '~/dev/ad/flivideo/flihub', ports: { client: null, server: 5101 }, group: 'flivideo', tier: 1, status: 'active', notes: '' },
    { key: 'angeleye', display: 'AngelEye', path: '~/dev/ad/apps/angeleye', ports: { client: null, server: 5051 }, group: 'apps', tier: 1, status: 'active', notes: '' },
  ]

  it('generates one check per app', () => {
    const script = appsPathScript(apps)
    expect(script).toContain('flihub:exists')
    expect(script).toContain('angeleye:exists')
    expect(script).toContain('flihub:missing')
  })

  it('replaces ~ with $HOME for shell expansion', () => {
    const script = appsPathScript(apps)
    expect(script).toContain('$HOME')
    expect(script).not.toContain('"~/')  // raw ~ in double-quotes won't expand
  })

  it('uses [ -d path ] for directory check', () => {
    const script = appsPathScript(apps)
    expect(script).toContain('[ -d ')
  })

  it('returns empty string for empty apps array', () => {
    expect(appsPathScript([])).toBe('')
  })
})

// ─── portsListScript ─────────────────────────────────────────────────────────

describe('portsListScript', () => {
  const script = portsListScript()

  it('uses lsof to list TCP listening ports', () => {
    expect(script).toContain('lsof')
    expect(script).toContain('-iTCP')
    expect(script).toContain('LISTEN')
  })

  it('uses -Pn -n to avoid reverse DNS lookups (faster)', () => {
    expect(script).toContain('-Pn')
    expect(script).toContain('-n')
  })

  it('deduplicates and sorts output', () => {
    expect(script).toContain('sort -un')
  })

  it('suppresses stderr', () => {
    expect(script).toContain('2>/dev/null')
  })
})

// ─── relayAndOMIScript ────────────────────────────────────────────────────────

describe('relayAndOMIScript', () => {
  const script = relayAndOMIScript()

  it('emits --- relay --- section marker', () => {
    expect(script).toContain('--- relay ---')
  })

  it('emits --- omi --- section marker', () => {
    expect(script).toContain('--- omi ---')
  })

  it('checks ~/relay directory', () => {
    expect(script).toContain('~/relay')
    expect(script).toContain('relay_exists:false')
  })

  it('checks ~/dev/raw-intake/omi directory', () => {
    expect(script).toContain('~/dev/raw-intake/omi')
    expect(script).toContain('omi_exists:false')
  })

  it('counts OMI enriched files by routing: frontmatter', () => {
    expect(script).toContain('routing:')
    expect(script).toContain('omi_enriched')
  })

  it('detects syncthing process', () => {
    expect(script).toContain('pgrep')
    expect(script).toContain('syncthing')
  })

  it('emits monthly breakdown', () => {
    expect(script).toContain('--- monthly ---')
    expect(script).toContain('month:')
  })
})

// ─── agentStateScript ─────────────────────────────────────────────────────────

describe('agentStateScript', () => {
  const script = agentStateScript()

  it('emits --- skills --- section marker', () => {
    expect(script).toContain('--- skills ---')
  })

  it('emits --- brains --- section marker', () => {
    expect(script).toContain('--- brains ---')
  })

  it('emits --- ansible --- section marker', () => {
    expect(script).toContain('--- ansible ---')
  })

  it('reads ~/.claude/skills/', () => {
    expect(script).toContain('~/.claude/skills/')
  })

  it('reads ~/.claude/plugins/', () => {
    expect(script).toContain('~/.claude/plugins/')
  })

  it('scans brains INDEX.md files', () => {
    expect(script).toContain('INDEX.md')
    expect(script).toContain('activity_level')
    expect(script).toContain('last_major_update')
  })

  it('scans ansible playbooks, roles, and inventory', () => {
    expect(script).toContain('*.yml')
    expect(script).toContain('roles')
    expect(script).toContain('host_vars')
  })
})

// ─── angelEyeScript ──────────────────────────────────────────────────────────

describe('angelEyeScript', () => {
  const script = angelEyeScript()

  it('checks for registry.json existence', () => {
    expect(script).toContain('registry.json')
    expect(script).toContain('installed:false')
  })

  it('checks port 5051 for running state', () => {
    expect(script).toContain('5051')
    expect(script).toContain('running:true')
  })

  it('uses python3 heredoc for JSON parsing', () => {
    expect(script).toContain('python3')
    expect(script).toContain('PYEOF')
    expect(script).toContain('json.load')
  })

  it('emits sessions_24h filtered by last_active', () => {
    expect(script).toContain('sessions_24h')
    expect(script).toContain('last_active')
    expect(script).toContain('timedelta')
  })
})

// ─── gitReposScript ───────────────────────────────────────────────────────────

describe('gitReposScript', () => {
  const script = gitReposScript(['~/dev/ad', '~/dev/clients', '~/dev/kgems'], 100)

  it('searches the configured paths', () => {
    expect(script).toContain('~/dev/ad')
    expect(script).toContain('~/dev/clients')
    expect(script).toContain('~/dev/kgems')
  })

  it('limits to maxRepos', () => {
    expect(script).toContain('head -100')
  })

  it('finds .git directories at maxdepth 4', () => {
    expect(script).toContain('.git')
    expect(script).toContain('-maxdepth 4')
  })

  it('collects branch, dirty, unpushed, last_commit, remote', () => {
    expect(script).toContain('branch --show-current')
    expect(script).toContain('status --porcelain')
    expect(script).toContain('log --branches --not --remotes')
    expect(script).toContain('log -1 --format="%cr"')
    expect(script).toContain('remote get-url origin')
  })

  it('emits pipe-delimited output', () => {
    expect(script).toContain('echo "$repo|$branch|$dirty|$unpushed|$last_commit|$remote"')
  })

  it('customises search paths', () => {
    const s2 = gitReposScript(['~/dev/custom'], 50)
    expect(s2).toContain('~/dev/custom')
    expect(s2).toContain('head -50')
  })
})
