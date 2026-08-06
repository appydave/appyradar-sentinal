/**
 * getDriftFindings — the not-checked vs checked-and-clean distinction.
 *
 * This is the THIRD instance of one defect class here (see the function's own
 * header). These tests exist to stop a fourth: they fail loudly if anyone
 * reintroduces `?? []` or counts online machines as checked.
 */
import { describe, it, expect } from 'vitest'
import { getDriftFindings } from '../access/query/fleet.js'
import type { FleetSnapshot, MachineSnapshot } from '../types.js'

function machine(over: Partial<MachineSnapshot>): MachineSnapshot {
  return {
    machine: 'm', host: 'h', status: 'online',
    checked_at: '2026-08-06T00:00:00.000Z', collection_errors: [],
    ...over,
  } as MachineSnapshot
}

function snap(machines: MachineSnapshot[]): FleetSnapshot {
  return {
    schema_version: '1.3',
    generated_at: new Date().toISOString(),
    summary: {
      total_machines: machines.length,
      online: machines.filter(m => m.status === 'online').length,
      offline: machines.filter(m => m.status !== 'online').length,
      offline_machines: [], apps_registered: 0,
    },
    machines,
  }
}

describe('getDriftFindings — not-checked vs clean', () => {
  it('reports drift:undefined as NOT CHECKED, never as clean', () => {
    const r = getDriftFindings(snap([machine({ machine: 'm4', drift: undefined })])) as any
    expect(r.data.machines_checked).toBe(0)
    expect(r.data.machines_not_checked).toHaveLength(1)
    expect(r.data.machines_not_checked[0].machine).toBe('m4')
  })

  it('reports drift:[] as CHECKED AND CLEAN', () => {
    const r = getDriftFindings(snap([machine({ machine: 'm4', drift: [] })])) as any
    expect(r.data.machines_checked).toBe(1)
    expect(r.data.machines_not_checked).toHaveLength(0)
    expect(r.data.finding_count).toBe(0)
  })

  it('an ONLINE machine is not automatically a CHECKED machine', () => {
    // The exact bug: machines_checked was `filter(status === 'online').length`.
    const r = getDriftFindings(snap([
      machine({ machine: 'a', status: 'online', drift: undefined }),
      machine({ machine: 'b', status: 'online', drift: undefined }),
      machine({ machine: 'c', status: 'online', drift: [] }),
    ])) as any
    expect(r.data.machines_checked).toBe(1)
    expect(r.data.machines_not_checked.map((x: any) => x.machine).sort()).toEqual(['a', 'b'])
  })

  it('does not list OFFLINE machines as not-checked — they are unreachable, not overdue', () => {
    const r = getDriftFindings(snap([
      machine({ machine: 'off', status: 'offline', drift: undefined }),
    ])) as any
    expect(r.data.machines_checked).toBe(0)
    expect(r.data.machines_not_checked).toHaveLength(0)
  })

  it('gathers findings only from checked machines', () => {
    const r = getDriftFindings(snap([
      machine({ machine: 'a', drift: [{ rule: 'log.unrotated', subject: '/x', severity: 'warning', detail: 'd' }] }),
      machine({ machine: 'b', drift: undefined }),
    ])) as any
    expect(r.data.finding_count).toBe(1)
    expect(r.data.findings[0].machine).toBe('a')
    expect(r.data.machines_checked).toBe(1)
    expect(r.data.machines_not_checked).toHaveLength(1)
  })

  it('reports minutes_until_due when driftRuns is supplied', () => {
    const elevenHoursAgo = new Date(Date.now() - 11 * 3_600_000).toISOString()
    const r = getDriftFindings(snap([machine({ machine: 'm4', drift: undefined })]), {
      driftRuns: { m4: elevenHoursAgo },
      driftIntervalHours: 12,
    }) as any
    expect(r.data.machines_not_checked[0].minutes_until_due).toBeGreaterThan(50)
    expect(r.data.machines_not_checked[0].minutes_until_due).toBeLessThanOrEqual(60)
  })

  it('reports null minutes when driftRuns is not supplied — never a fabricated 0', () => {
    const r = getDriftFindings(snap([machine({ machine: 'm4', drift: undefined })])) as any
    expect(r.data.machines_not_checked[0].minutes_until_due).toBeNull()
  })

  it('ranks findings critical > warning > info', () => {
    const r = getDriftFindings(snap([machine({ machine: 'a', drift: [
      { rule: 'z.info', subject: 's', severity: 'info', detail: '' },
      { rule: 'a.crit', subject: 's', severity: 'critical', detail: '' },
      { rule: 'm.warn', subject: 's', severity: 'warning', detail: '' },
    ] })])) as any
    expect(r.data.findings.map((f: any) => f.severity)).toEqual(['critical', 'warning', 'info'])
  })
})
