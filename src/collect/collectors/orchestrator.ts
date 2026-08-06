/**
 * collectMachine() — orchestrates SSH calls for one machine.
 *
 * This is the entry point for the orchestrator-ssh recipe (pattern C2).
 * It wires ssh/client + collectors/bash-scripts + collectors/parsers together.
 *
 * When AppySentinel is wired up, the harness calls this function and wraps
 * the result in a Signal:
 *   sentinel.emit({ kind: 'state', name: 'machine.snapshot', source: 'orchestrator-ssh', payload: result })
 *
 * SSH batching: see docs/ssh-batching.md.
 * Collection frequency: full snapshot only; fast-path (memory+apps) is split out
 * when the always-running harness arrives and setInterval calls need separation.
 */

import { sshStatus, sshScript } from '../ssh/client.js'
import {
  systemSnapshotScript,
  toolsScript,
  appsPathScript,
  portsListScript,
  relayAndOMIScript,
  agentStateScript,
  angelEyeScript,
  gitReposScript,
  driftScript,
} from './bash-scripts.js'
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
  parseDrift,
} from './parsers.js'
import type { MachineConfig, AppEntry, MachineSnapshot, CollectionError } from '../../types.js'

export const GIT_SEARCH_PATHS = ['~/dev/ad', '~/dev/clients', '~/dev/kgems']
export const MAX_REPOS = 100

/** Collect full state snapshot for one machine. */
export async function collectMachine(
  machine: MachineConfig,
  apps: AppEntry[],
  options: { skipGit?: boolean; runDrift?: boolean; log?: (msg: string) => void } = {}
): Promise<MachineSnapshot> {
  const { skipGit = false, runDrift = false, log = () => {} } = options
  const errors: CollectionError[] = []

  const track = (collector: string, raw: string): string => {
    if (raw === '') errors.push({ collector, reason: 'ssh_empty' })
    return raw
  }

  log(`\n→ ${machine.name} (${machine.host})`)

  const reachability = sshStatus(machine.host)

  if (reachability === 'auth_failure') {
    log(`  ✗ auth failure — run: ssh-copy-id ${machine.host}`)
    return { machine: machine.name, host: machine.host, status: 'auth_failure', checked_at: new Date().toISOString(), collection_errors: [] }
  }

  if (reachability === 'unreachable') {
    log(`  ✗ offline`)
    return { machine: machine.name, host: machine.host, status: 'offline', checked_at: new Date().toISOString(), collection_errors: [] }
  }

  log(`  ✓ online`)

  // ── Batch 1: identity + system + memory_pressure + disk (1 SSH) ────────────
  log(`    system snapshot (identity + memory + disk)...`)
  const snapshotRaw = track('system_snapshot', sshScript(machine.host, systemSnapshotScript()))
  const { identity: identityRaw, system: systemRaw, disk: diskRaw } = splitSystemSnapshot(snapshotRaw)
  const identity = parseIdentity(identityRaw)
  const system   = parseSystem(systemRaw)
  const memory   = parseMemory(system)
  const disk     = parseDisk(diskRaw)

  // ── Tools (1 SSH) ───────────────────────────────────────────────────────────
  log(`    tools...`)
  const tools = parseTools(track('tools', sshScript(machine.host, toolsScript())))

  // ── Apps: path existence (1 SSH) + port listening (1 SSH) ──────────────────
  log(`    apps (${apps.length} known)...`)
  const pathRaw    = track('apps_path',  sshScript(machine.host, appsPathScript(apps)))
  const portRaw    = track('apps_ports', sshScript(machine.host, portsListScript()))
  const app_status = parseApps(pathRaw, portRaw, apps)

  // ── Batch 2: relay + OMI (1 SSH) ────────────────────────────────────────────
  log(`    relay + omi...`)
  const relayOMIRaw         = track('relay_omi', sshScript(machine.host, relayAndOMIScript()))
  const { relay: relayRaw, omi: omiRaw } = splitRelayAndOMI(relayOMIRaw)
  const relay = parseRelay(relayRaw)
  const omi   = parseOMI(omiRaw)

  // ── Batch 3: skills + brains + ansible (1 SSH) ─────────────────────────────
  log(`    skills + brains + ansible...`)
  const agentRaw = track('agent_state', sshScript(machine.host, agentStateScript()))
  const { skills: skillsRaw, brains: brainsRaw, ansible: ansibleRaw } = splitAgentState(agentRaw)
  const skills  = parseSkills(skillsRaw)
  const brains  = parseBrains(brainsRaw)
  const ansible = parseAnsible(ansibleRaw)

  // ── AngelEye (1 SSH) ────────────────────────────────────────────────────────
  log(`    angeleye...`)
  const angeleye = parseAngelEye(track('angeleye', sshScript(machine.host, angelEyeScript())))

  // ── Drift detection (1 SSH, THROTTLED — off by default) ────────────────────
  //
  // Runs only when the caller says so. These rules walk the filesystem and the
  // facts they find change over days, not minutes — see collect/drift-schedule.ts.
  // `undefined` (not `[]`) means "not checked this cycle", which is different
  // from "checked, nothing wrong". Consumers must not read a missing field as a
  // clean bill of health.
  //
  // ⚠️ NOT wrapped in track() — deliberately. Read the comment below before
  // "fixing" this.
  //
  // track() records "this collector returned nothing" as a collection ERROR,
  // because for every other collector an empty SSH response means the call
  // failed. Drift is the opposite: no output means NO RULE FIRED, which is a
  // healthy machine. If drift went through track(), a machine with nothing
  // wrong would be reported as having a broken collector.
  //
  // This is the same class of bug as getFleetStatus()'s disk_alert returning
  // 'ok' for machines that had never been measured (fixed 2026-08-04): a value
  // that means "no data" being rendered as a value that means "fine". Whenever
  // absence and success look identical, check which one the code assumes.
  let drift: ReturnType<typeof parseDrift> | undefined
  if (runDrift) {
    log(`    drift rules...`)
    drift = parseDrift(sshScript(machine.host, driftScript()))
    if (drift.length > 0) {
      log(`    ⚠ ${drift.length} drift finding(s): ${[...new Set(drift.map(d => d.rule))].join(', ')}`)
    }
  }

  // ── Git repos (optional, slow ~3-5 min) ────────────────────────────────────
  let git_repos: ReturnType<typeof parseGitRepos> = []
  if (!skipGit) {
    log(`    git repos...`)
    const gitRaw  = track('git_repos', sshScript(machine.host, gitReposScript(GIT_SEARCH_PATHS, MAX_REPOS)))
    git_repos     = parseGitRepos(gitRaw)
    const dirty   = git_repos.filter(r => r.dirty_files > 0).length
    const unpushed = git_repos.filter(r => r.unpushed_commits > 0).length
    log(`    found ${git_repos.length} repos — ${dirty} dirty, ${unpushed} unpushed`)
  }

  if (errors.length > 0) {
    log(`  ⚠ ${errors.length} collector(s) returned empty: ${errors.map(e => e.collector).join(', ')}`)
  }

  return {
    machine:          machine.name,
    host:             machine.host,
    status:           'online',
    checked_at:       new Date().toISOString(),
    collection_errors: errors,
    identity,
    system,
    memory,
    disk,
    tools,
    app_status,
    relay,
    omi,
    skills,
    brains,
    ansible,
    angeleye,
    git_repos,
    drift,
  }
}
