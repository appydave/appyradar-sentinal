/**
 * Drift scheduling tests.
 *
 * The behaviour that matters most is the restart case: a cycle COUNTER would
 * reset on restart and re-run drift on every machine at once. Timestamps must
 * not. Several tests below exist only to pin that down.
 */
import { describe, it, expect } from 'vitest'
import {
  isDriftDue,
  minutesUntilDriftDue,
  DEFAULT_DRIFT_INTERVAL_HOURS,
} from '../collect/drift-schedule.js'

const NOW = new Date('2026-08-06T12:00:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString()

describe('isDriftDue', () => {
  it('defaults to a 12 hour interval', () => {
    expect(DEFAULT_DRIFT_INTERVAL_HOURS).toBe(12)
  })

  it('is due for a machine never seen — first contact sets a baseline', () => {
    expect(isDriftDue('new-machine', {}, 12, NOW)).toBe(true)
  })

  it('is NOT due one hour after a run', () => {
    expect(isDriftDue('m4', { m4: hoursAgo(1) }, 12, NOW)).toBe(false)
  })

  it('is NOT due at 11 hours', () => {
    expect(isDriftDue('m4', { m4: hoursAgo(11) }, 12, NOW)).toBe(false)
  })

  it('is due at exactly the interval', () => {
    expect(isDriftDue('m4', { m4: hoursAgo(12) }, 12, NOW)).toBe(true)
  })

  it('is due well past the interval', () => {
    expect(isDriftDue('m4', { m4: hoursAgo(48) }, 12, NOW)).toBe(true)
  })

  it('honours a custom interval', () => {
    expect(isDriftDue('m4', { m4: hoursAgo(2) }, 1, NOW)).toBe(true)
    expect(isDriftDue('m4', { m4: hoursAgo(2) }, 6, NOW)).toBe(false)
  })

  it('treats an unparseable timestamp as due — running twice beats never running', () => {
    expect(isDriftDue('m4', { m4: 'not-a-date' }, 12, NOW)).toBe(true)
  })

  it('tracks machines independently — one being due does not drag in the others', () => {
    const runs = { m4: hoursAgo(1), jan: hoursAgo(20) }
    expect(isDriftDue('m4', runs, 12, NOW)).toBe(false)
    expect(isDriftDue('jan', runs, 12, NOW)).toBe(true)
  })

  it('SURVIVES A RESTART: state is timestamps, so a fresh process still sees "not due"', () => {
    // Simulates the daemon restarting — the same persisted state is re-read.
    // A cycle counter would be back at 0 here and would re-run everything.
    const persisted = { m4: hoursAgo(2), jan: hoursAgo(3), mary: hoursAgo(1) }
    for (const m of Object.keys(persisted)) {
      expect(isDriftDue(m, persisted, 12, NOW)).toBe(false)
    }
  })
})

describe('minutesUntilDriftDue', () => {
  it('returns 0 for a machine never seen', () => {
    expect(minutesUntilDriftDue('new', {}, 12, NOW)).toBe(0)
  })

  it('returns the remaining minutes', () => {
    expect(minutesUntilDriftDue('m4', { m4: hoursAgo(11) }, 12, NOW)).toBe(60)
  })

  it('never returns a negative — overdue clamps to 0', () => {
    expect(minutesUntilDriftDue('m4', { m4: hoursAgo(99) }, 12, NOW)).toBe(0)
  })
})
