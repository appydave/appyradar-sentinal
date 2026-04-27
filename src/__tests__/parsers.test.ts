/**
 * Unit tests for collectors/parsers.ts
 *
 * No SSH, no filesystem. Pure string → typed result.
 * Fixture strings mirror real sshScript() output.
 */

import { describe, it, expect } from 'vitest'
import {
  splitSystemSnapshot,
  parseIdentity,
  parseSystem,
  parseMemory,
  parseDisk,
  parseTools,
  parseApps,
  splitRelayAndOMI,
  parseRelay,
  parseOMI,
  splitAgentState,
  parseSkills,
  parseBrains,
  parseAnsible,
  parseAngelEye,
  parseGitRepos,
} from '../collectors/parsers.js'
import type { AppEntry, SystemPayload } from '../types.js'

// ─── splitSystemSnapshot ──────────────────────────────────────────────────────

describe('splitSystemSnapshot', () => {
  it('splits into three sections', () => {
    const raw = [
      '--- identity ---',
      'hostname:MacBook-Pro.local',
      '--- system ---',
      'cpu_cores:10',
      '--- disk ---',
      '/dev/disk3s5|926000000|689000000|200000000|78|/System/Volumes/Data',
    ].join('\n')

    const { identity, system, disk } = splitSystemSnapshot(raw)
    expect(identity).toContain('hostname:MacBook-Pro.local')
    expect(system).toContain('cpu_cores:10')
    expect(disk).toContain('/dev/disk3s5')
  })

  it('handles missing sections gracefully', () => {
    const { identity, system, disk } = splitSystemSnapshot('--- identity ---\nhostname:test')
    expect(identity).toContain('hostname:test')
    expect(system).toBe('')
    expect(disk).toBe('')
  })

  it('never throws on null/empty', () => {
    expect(() => splitSystemSnapshot('')).not.toThrow()
    expect(() => splitSystemSnapshot(null as any)).not.toThrow()
  })
})

// ─── parseIdentity ────────────────────────────────────────────────────────────

describe('parseIdentity', () => {
  const fixture = [
    'hostname:MacBook-Pro.local',
    'os:26.2',
    'arch:arm64',
    'uptime:20 days, 12:35',
    'user:davidcruwys',
    'load_1m:4.46',
    'load_5m:2.82',
  ].join('\n')

  it('parses all fields', () => {
    const r = parseIdentity(fixture)
    expect(r.hostname).toBe('MacBook-Pro.local')
    expect(r.os).toBe('26.2')
    expect(r.arch).toBe('arm64')
    expect(r.user).toBe('davidcruwys')
    expect(r.load_1m).toBeCloseTo(4.46)
    expect(r.load_5m).toBeCloseTo(2.82)
  })

  it('returns zero loads for missing fields', () => {
    const r = parseIdentity('hostname:test')
    expect(r.load_1m).toBe(0)
    expect(r.load_5m).toBe(0)
  })

  it('never throws on null/empty', () => {
    expect(() => parseIdentity('')).not.toThrow()
    expect(() => parseIdentity(null as any)).not.toThrow()
  })
})

// ─── parseSystem ─────────────────────────────────────────────────────────────

describe('parseSystem', () => {
  it('parses all fields', () => {
    const raw = [
      'mem_raw:PhysMem: 23G used (4323M wired, 9120M compressor), 246M unused.',
      'cpu_cores:10',
      'ram_total_gb:24',
      'memory_pressure_raw:1',
    ].join('\n')

    const r = parseSystem(raw)
    expect(r.cpu_cores).toBe(10)
    expect(r.ram_total_gb).toBe(24)
    expect(r.memory_pressure_raw).toBe('1')
    expect(r.mem_raw).toContain('PhysMem')
  })

  it('returns zeros for missing fields', () => {
    const r = parseSystem('')
    expect(r.cpu_cores).toBe(0)
    expect(r.ram_total_gb).toBe(0)
  })

  it('never throws on null/empty', () => {
    expect(() => parseSystem(null as any)).not.toThrow()
  })
})

// ─── parseMemory ─────────────────────────────────────────────────────────────

describe('parseMemory', () => {
  const baseSystem = (overrides: Partial<SystemPayload> = {}): SystemPayload => ({
    mem_raw: 'PhysMem: 23G used (4323M wired, 9120M compressor), 246M unused.',
    cpu_cores: 10,
    ram_total_gb: 24,
    memory_pressure_raw: '1',
    ...overrides,
  })

  it('uses sysctl pressure level — 1 → ok', () => {
    const r = parseMemory(baseSystem({ memory_pressure_raw: '1' }))
    expect(r.pressure).toBe('ok')
  })

  it('2 → warning', () => {
    const r = parseMemory(baseSystem({ memory_pressure_raw: '2' }))
    expect(r.pressure).toBe('warning')
  })

  it('4 → critical', () => {
    const r = parseMemory(baseSystem({ memory_pressure_raw: '4' }))
    expect(r.pressure).toBe('critical')
  })

  it('falls back to use_pct heuristic when memory_pressure_raw absent', () => {
    const r = parseMemory(baseSystem({ memory_pressure_raw: '' }))
    // 23/24 = 96% → critical via heuristic
    expect(r.pressure).toBe('critical')
  })

  it('parses G-suffix memory correctly', () => {
    const r = parseMemory(baseSystem({
      mem_raw: 'PhysMem: 7.96G used (2.35G wired), 8.17G unused.',
      ram_total_gb: 16,
    }))
    expect(r.used_gb).toBeGreaterThan(7)
    expect(r.free_gb).toBeGreaterThan(8)
    expect(r.total_gb).toBe(16)
  })

  it('parses M-suffix memory correctly', () => {
    const r = parseMemory(baseSystem({
      mem_raw: 'PhysMem: 8151M used (1337M wired), 9033M unused.',
      ram_total_gb: 0,
    }))
    expect(r.used_gb).toBeGreaterThan(7)
    expect(r.free_gb).toBeGreaterThan(8)
    expect(r.use_pct).toBeGreaterThan(40)
  })

  it('never throws on empty system', () => {
    expect(() => parseMemory({ mem_raw: '', cpu_cores: 0, ram_total_gb: 0, memory_pressure_raw: '' })).not.toThrow()
  })
})

// ─── parseDisk ───────────────────────────────────────────────────────────────

describe('parseDisk', () => {
  it('parses pipe-delimited volume lines', () => {
    const raw = '/dev/disk3s5|926000000|689000000|200000000|78|/System/Volumes/Data'
    const [vol] = parseDisk(raw)
    expect(vol!.filesystem).toBe('/dev/disk3s5')
    expect(vol!.use_pct).toBe(78)
    expect(vol!.mount).toBe('/System/Volumes/Data')
    expect(vol!.alert).toBe('warning')  // 78 >= 70
    expect(vol!.used_gb).toBeGreaterThan(650)
  })

  it('applies correct alert thresholds', () => {
    expect(parseDisk('/dev/x|100000|90000|10000|90|/a')[0]!.alert).toBe('critical')  // >= 85
    expect(parseDisk('/dev/x|100000|70000|30000|70|/a')[0]!.alert).toBe('warning')   // >= 70
    expect(parseDisk('/dev/x|100000|50000|50000|50|/a')[0]!.alert).toBe('ok')         // < 70
  })

  it('parses multiple volumes', () => {
    const raw = [
      '/dev/disk3s1|100000|10000|90000|10|/',
      '/dev/disk3s5|100000|80000|20000|80|/System/Volumes/Data',
    ].join('\n')
    expect(parseDisk(raw)).toHaveLength(2)
  })

  it('returns empty array for empty input', () => {
    expect(parseDisk('')).toHaveLength(0)
    expect(parseDisk(null as any)).toHaveLength(0)
  })

  it('never throws on malformed lines', () => {
    expect(() => parseDisk('not|valid|at|all')).not.toThrow()
    expect(() => parseDisk('|||')).not.toThrow()
  })
})

// ─── parseTools ──────────────────────────────────────────────────────────────

describe('parseTools', () => {
  it('parses present tools', () => {
    const raw = [
      'ruby:ruby 2.6.10p210 (2022-04-12 revision 67958)',
      'node:v24.13.0',
      'git:git version 2.49.0',
      'claude:2.1.119 (Claude Code)',
      'brew_outdated:94',
    ].join('\n')
    const r = parseTools(raw)
    expect(r.ruby).toContain('ruby 2.6.10')
    expect(r.node).toBe('v24.13.0')
    expect(r.brew_outdated).toBe(94)
  })

  it('returns null for missing tools', () => {
    const r = parseTools('ruby:\nbun:\ndocker:')
    expect(r.ruby).toBeNull()
    expect(r.bun).toBeNull()
    expect(r.docker).toBeNull()
  })

  it('returns null brew_outdated when blank', () => {
    const r = parseTools('brew_outdated:')
    expect(r.brew_outdated).toBeNull()
  })

  it('never throws on null/empty', () => {
    expect(() => parseTools('')).not.toThrow()
    expect(() => parseTools(null as any)).not.toThrow()
  })
})

// ─── parseApps ───────────────────────────────────────────────────────────────

describe('parseApps', () => {
  const apps: AppEntry[] = [
    { key: 'flihub', display: 'FliHub', path: '~/dev/ad/flivideo/flihub', ports: { client: null, server: 5101 }, group: 'flivideo', tier: 1, status: 'active', notes: '' },
    { key: 'flideck', display: 'FliDeck', path: '~/dev/ad/flivideo/flideck', ports: { client: 5200, server: 5201 }, group: 'flivideo', tier: 1, status: 'active', notes: '' },
  ]

  it('marks existing path', () => {
    const r = parseApps('flihub:exists\nflideck:missing', '', apps)
    expect(r.find(a => a.key === 'flihub')!.path_exists).toBe(true)
    expect(r.find(a => a.key === 'flideck')!.path_exists).toBe(false)
  })

  it('marks running when port is listening', () => {
    const portRaw = '5101\n5200'
    const r = parseApps('flihub:exists\nflideck:exists', portRaw, apps)
    expect(r.find(a => a.key === 'flihub')!.running).toBe(true)
    expect(r.find(a => a.key === 'flideck')!.running).toBe(true)
  })

  it('marks not running when no ports listening', () => {
    const r = parseApps('flihub:exists', '', apps)
    expect(r.find(a => a.key === 'flihub')!.running).toBe(false)
  })

  it('never throws on empty input', () => {
    expect(() => parseApps('', '', [])).not.toThrow()
    expect(() => parseApps(null as any, null as any, [])).not.toThrow()
  })
})

// ─── parseRelay ──────────────────────────────────────────────────────────────

describe('parseRelay', () => {
  it('returns exists:false when not present', () => {
    expect(parseRelay('relay_exists:false').exists).toBe(false)
  })

  it('parses folders and syncthing status', () => {
    const raw = [
      'relay_exists:true',
      'folder:flihub-appydave|145|2026-04-20 10:30',
      'folder:david-jan|2580|2026-04-21 08:00',
      'syncthing_running:true',
    ].join('\n')
    const r = parseRelay(raw)
    expect(r.exists).toBe(true)
    expect(r.syncthing_running).toBe(true)
    expect(r.folders).toHaveLength(2)
    expect(r.folders![0]!.name).toBe('flihub-appydave')
    expect(r.folders![0]!.file_count).toBe(145)
  })

  it('never throws on null/empty', () => {
    expect(() => parseRelay('')).not.toThrow()
    expect(() => parseRelay(null as any)).not.toThrow()
  })
})

// ─── parseOMI ────────────────────────────────────────────────────────────────

describe('parseOMI', () => {
  it('returns exists:false when not present', () => {
    expect(parseOMI('omi_exists:false').exists).toBe(false)
  })

  it('parses counts and monthly breakdown', () => {
    const raw = [
      'omi_exists:true',
      'omi_total:1041',
      'omi_enriched:912',
      'omi_pending:129',
      'omi_newest:2026-04-27-conversation.md',
      'omi_oldest:2024-01-15-intro.md',
      'month:2026-04|45',
      'month:2026-03|89',
      'pending_file:2026-04-01-pending.md',
    ].join('\n')

    const r = parseOMI(raw)
    expect(r.exists).toBe(true)
    expect(r.total_files).toBe(1041)
    expect(r.enriched_files).toBe(912)
    expect(r.pending_files).toBe(129)
    expect(r.monthly_breakdown!['2026-04']).toBe(45)
    expect(r.sample_pending).toHaveLength(1)
  })

  it('never throws on null/empty', () => {
    expect(() => parseOMI('')).not.toThrow()
    expect(() => parseOMI(null as any)).not.toThrow()
  })
})

// ─── parseSkills ─────────────────────────────────────────────────────────────

describe('parseSkills', () => {
  it('parses skills, plugins, and claude version', () => {
    const raw = [
      'global:radar',
      'global:commit',
      'global:simplify',
      'plugin:brand-dave',
      'plugin:appydave',
      'command:review',
      'claude_version:2.1.119 (Claude Code)',
    ].join('\n')

    const r = parseSkills(raw)
    expect(r.global_skills).toHaveLength(3)
    expect(r.global_skills).toContain('radar')
    expect(r.plugins).toHaveLength(2)
    expect(r.commands).toHaveLength(1)
    expect(r.claude_version).toBe('2.1.119 (Claude Code)')
  })

  it('returns empty arrays for machine with no skills', () => {
    const r = parseSkills('claude_version:2.1.85 (Claude Code)')
    expect(r.global_skills).toHaveLength(0)
    expect(r.plugins).toHaveLength(0)
  })

  it('never throws on null/empty', () => {
    expect(() => parseSkills('')).not.toThrow()
    expect(() => parseSkills(null as any)).not.toThrow()
  })
})

// ─── parseBrains ─────────────────────────────────────────────────────────────

describe('parseBrains', () => {
  it('returns exists:false when absent', () => {
    expect(parseBrains('brains_exists:false').exists).toBe(false)
  })

  it('parses brain list and stale analysis', () => {
    const raw = [
      'brains_exists:true',
      'brain:brand-dave|active|high|2026-04-01|45',
      'brain:als|active|medium|2025-12-01|12',  // stale (>60 days)
      'brain:davidcruwys|active|low|2026-03-15|8',
    ].join('\n')

    const r = parseBrains(raw)
    expect(r.exists).toBe(true)
    expect(r.total).toBe(3)
    expect(r.stale_count).toBeGreaterThanOrEqual(1)
    expect(r.by_activity!.high).toBe(1)
    expect(r.by_activity!.medium).toBe(1)
  })

  it('never throws on null/empty', () => {
    expect(() => parseBrains('')).not.toThrow()
    expect(() => parseBrains(null as any)).not.toThrow()
  })
})

// ─── parseAnsible ────────────────────────────────────────────────────────────

describe('parseAnsible', () => {
  it('returns exists:false when absent', () => {
    expect(parseAnsible('ansible_exists:false').exists).toBe(false)
  })

  it('parses playbooks, roles, and hosts', () => {
    const raw = [
      'ansible_exists:true',
      'playbook:site',
      'playbook:discovery',
      'role:claude-setup',
      'role:tailscale',
      'host:macbook-pro',
      'host:mac-mini-m4',
    ].join('\n')

    const r = parseAnsible(raw)
    expect(r.exists).toBe(true)
    expect(r.playbooks).toHaveLength(2)
    expect(r.roles).toHaveLength(2)
    expect(r.inventory_hosts).toHaveLength(2)
    expect(r.playbooks).toContain('site')
  })

  it('never throws on null/empty', () => {
    expect(() => parseAnsible('')).not.toThrow()
    expect(() => parseAnsible(null as any)).not.toThrow()
  })
})

// ─── parseAngelEye ───────────────────────────────────────────────────────────

describe('parseAngelEye', () => {
  it('returns installed:false when absent', () => {
    expect(parseAngelEye('installed:false').installed).toBe(false)
  })

  it('parses full AngelEye state', () => {
    const raw = [
      'installed:true',
      'running:false',
      'total_sessions:1975',
      'active_sessions:0',
      'sessions_24h:12',
      'top_project:appyradar',
      'top_project_count:5',
      'type_interactive:8',
      'type_task:4',
    ].join('\n')

    const r = parseAngelEye(raw)
    expect(r.installed).toBe(true)
    expect(r.running).toBe(false)
    expect(r.total_sessions).toBe(1975)
    expect(r.sessions_24h).toBe(12)
    expect(r.top_project).toBe('appyradar')
    expect(r.session_types_24h!['INTERACTIVE']).toBe(8)
  })

  it('never throws on null/empty', () => {
    expect(() => parseAngelEye('')).not.toThrow()
    expect(() => parseAngelEye(null as any)).not.toThrow()
  })
})

// ─── parseGitRepos ────────────────────────────────────────────────────────────

describe('parseGitRepos', () => {
  it('parses repo list', () => {
    const raw = [
      '/Users/davidcruwys/dev/ad/apps/appyradar|main|3|1|2 hours ago|git@github.com:user/appyradar.git',
      '/Users/davidcruwys/dev/ad/apps/angeleye|main|0|0|3 days ago|git@github.com:user/angeleye.git',
    ].join('\n')

    const r = parseGitRepos(raw)
    expect(r).toHaveLength(2)
    expect(r[0]!.branch).toBe('main')
    expect(r[0]!.dirty_files).toBe(3)
    expect(r[0]!.unpushed_commits).toBe(1)
    expect(r[1]!.dirty_files).toBe(0)
  })

  it('handles missing optional fields', () => {
    const raw = '/Users/davidcruwys/dev/ad/test||||'
    const [r] = parseGitRepos(raw)
    expect(r!.path).toBe('/Users/davidcruwys/dev/ad/test')
    expect(r!.branch).toBeNull()
    expect(r!.dirty_files).toBe(0)
  })

  it('returns empty array for empty input', () => {
    expect(parseGitRepos('')).toHaveLength(0)
    expect(parseGitRepos(null as any)).toHaveLength(0)
  })
})
