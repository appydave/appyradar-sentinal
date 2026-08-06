/**
 * Drift detector tests.
 *
 * Covers the parser contract and the shape of the emitted bash. The rules
 * themselves are validated by running driftScript() against a real machine —
 * see docs/proposal-drift-detection.md for the incident behind each one.
 */
import { describe, it, expect } from 'vitest'
import { parseDrift } from '../collect/collectors/parsers.js'
import { driftScript } from '../collect/collectors/bash-scripts.js'

describe('parseDrift', () => {
  it('returns [] for empty input — silence is a PASS, not a failure', () => {
    expect(parseDrift('')).toEqual([])
    expect(parseDrift('--- drift ---')).toEqual([])
  })

  it('parses a well-formed finding', () => {
    const r = parseDrift('log.unrotated|/tmp/a.log|warning|181MB, ~21MB/day, no rotation')
    expect(r).toHaveLength(1)
    expect(r[0]).toEqual({
      rule: 'log.unrotated',
      subject: '/tmp/a.log',
      severity: 'warning',
      detail: '181MB, ~21MB/day, no rotation',
    })
  })

  it('keeps pipes that appear inside detail', () => {
    const r = parseDrift('pnpm.store_version_drift|v10 v11|info|2 stores | prune per major')
    expect(r[0]?.detail).toBe('2 stores | prune per major')
  })

  it('defaults an unrecognised severity to info rather than trusting it', () => {
    expect(parseDrift('x.y|s|bogus|d')[0]?.severity).toBe('info')
  })

  it('skips the section marker and blank lines', () => {
    expect(parseDrift('--- drift ---\n\nrule.a|s|info|d\n\n')).toHaveLength(1)
  })

  it('skips malformed lines instead of emitting junk findings', () => {
    expect(parseDrift('no-pipes-here\n|missing-rule|info|d\nrule.b|s|info|d')).toHaveLength(1)
  })
})

describe('driftScript', () => {
  const script = driftScript()

  it('emits the section marker the splitter expects', () => {
    expect(script).toContain('--- drift ---')
  })

  it.each([
    ['log.unrotated'],
    ['repo.filter_lost'],
    ['git.orphan_artifacts'],
    ['pnpm.store_version_drift'],
    ['backup.frozen'],
    ['sqlite.bloated'],
  ])('includes the %s rule', (rule: string) => {
    expect(script).toContain(rule)
  })

  it('suppresses stderr on every find, so EACCES noise never reaches the parser', () => {
    // Join backslash line-continuations first — the finds are wrapped for
    // readability, so a naive per-line check reports a false failure when
    // `2>/dev/null` sits on the continuation. (It did, on 2026-08-06.)
    const logical = script
      .replace(/\\\s*\n\s*/g, ' ')
      .split('\n')
      .filter(l => l.includes('find ') && !l.trim().startsWith('#'))

    expect(logical.length).toBeGreaterThan(0)
    for (const f of logical) expect(f).toContain('2>/dev/null')
  })

  it('bounds every filesystem walk with -maxdepth — an unbounded walk is the cost bug', () => {
    const logical = script
      .replace(/\\\s*\n\s*/g, ' ')
      .split('\n')
      .filter(l => l.includes('/usr/bin/find') && !l.trim().startsWith('#'))

    expect(logical.length).toBeGreaterThan(0)
    for (const f of logical) {
      // The pack-file scan is already confined to one repo's objects/pack dir.
      if (f.includes('objects/pack')) continue
      expect(f).toContain('-maxdepth')
    }
  })

  it('prunes node_modules on the ~/dev walk — millions of inodes with no findings in them', () => {
    const logical = script.replace(/\\\s*\n\s*/g, ' ')
    expect(logical).toMatch(/find "\$HOME\/dev".*-name node_modules.*-prune/)
  })

  it('uses absolute tool paths — a non-interactive SSH shell has a minimal PATH', () => {
    expect(script).toContain('/usr/bin/stat')
    expect(script).toContain('/usr/bin/du')
  })
})
