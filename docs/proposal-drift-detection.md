# Proposal — Time Series + Drift Detection

**Status**: **detectors SHIPPED 2026-08-06** (step 3 of the build order, ahead of the time series).
The series and the findings-lifecycle store remain proposed.
**Origin**: a 3-day disk investigation on mac-mini-m4 (53 GiB → 31 GiB in 27 hours) where every question
took manual forensics that a time series would have answered in one query.
**Related**: `~/dev/ad/brains/mac-os/disk-maintenance-rules.md`, `~/dev/ad/brains/mac-os/apfs-disk-audit.md`

---

## Problem

AppyRadar collects rich fleet state every few minutes and **throws all of it away except the latest
snapshot**. Three consequences, all observed:

1. **"What changed since Tuesday?" requires forensics.** Reconstructing a 20 GiB loss meant hand-running
   `find -newermt`, comparing `du` against numbers written down in a brain doc two days earlier, and
   reasoning about which of four candidate causes fit. ~10 minutes. With history: one query.
2. **Rates are invisible.** Disk problems here are *rate* problems, not threshold problems — the machine
   burns 1.7–7.7 GiB/day depending on workload. A threshold alarm fires when it is already too late; a
   derivative would have flagged it days earlier.
3. **Regressions are silent.** A July cleanup took `remotion/.git` from 3.6 GiB → 419 MB. On 2026-08-05
   an unrelated session re-fetched it back to 5.7 GiB. Nobody did anything wrong, and nothing noticed.

---

## Design — the split that matters

**Do not model these the same way.** Conflating them is the mistake this proposal exists to avoid.

### Facts → time series (append-only)

One row per metric per collection. Dumb, cheap, never updated.

```
ts | machine | metric              | value  | unit
---+---------+---------------------+--------+-----
   | m4      | disk.data.free      | 31.4   | GiB
   | m4      | swap.total          | 24.0   | GiB
   | m4      | repo.remotion.git   | 5741   | MB
```

Answers: *when did this start · what is the rate · is it accelerating.*

### Findings → stateful, with a lifecycle

One row per **distinct violation**, updated in place. **Not** one row per tick — otherwise a single
open finding becomes thousands of identical rows and "when did this start" is unanswerable.

```
id | machine | rule                  | subject          | severity | first_seen | last_seen | resolved_at
---+---------+-----------------------+------------------+----------+------------+-----------+------------
   | m4      | repo.filter_lost      | remotion         | warning  | 08-05 09:05| 08-05 18:2| NULL
   | m4      | log.unrotated         | captains-log     | warning  | 07-24 13:37| 08-04 13:2| 08-04 13:25
```

Answers: *what is broken · how long · did the fix hold.*

---

## Detectors — earned, not imagined

Every one below cost real investigation time this week. **Ship these; do not build a rules DSL.**
Each is a bash predicate returning JSON — the shape `collect/collectors/bash-scripts.ts` already uses.

| Rule | Predicate | Why |
|---|---|---|
| `repo.filter_lost` | upstream repo lacks `remote.origin.promisor` **or** `refs/remotes`+`refs/tags` > 50 | remotion silently regained 5.3 GiB |
| `log.unrotated` | launchd `StandardOutPath` growing > 5 MB/day | 181 MB + 48 MB found unnoticed; ~7.6 GB/yr |
| `git.orphan_artifacts` | `tmp_pack_*` older than 1 h | 2.0 GiB left by an interrupted fetch |
| `pnpm.store_version_drift` | active `pnpm store path` version ≠ version pinned in `packageManager` | `store prune` silently no-ops; nearly cost 5 GiB |
| `backup.frozen` | `*backup*`/`pre-*` dir unmodified > 30 d | 2.5 GiB frozen since an upgrade 14 d prior |
| `repo.archived_with_local_commits` | GitHub repo archived **and** local commits ahead | 4 commits unpushable and unbacked-up; found only by accident |
| `swap.regrowth` | swapfile count rising while uptime > 3 d | swap is a rate, not a stock — reboot is a ~4-day loan |
| `disk.trending_full` | linear fit on `disk.*.free` crosses 0 within 14 d | thresholds fire too late on a machine at 90% |
| `sqlite.bloated` | SQLite file where `freelist_count` > 50% of `page_count` | Wispr Flow: 3.26 GiB file holding 0.13 GiB of data — 96% already-deleted pages that `auto_vacuum=0` never returns. Invisible to every disk tool |
| `dupe.real_copies` | identical size+name in two trees, both `privatesize > 0` | ~16 GiB of real copies where clones were expected |

⚠️ `dupe.real_copies` requires the APFS clone probe — `du`/`nlink` **cannot** see this.
See `apfs-disk-audit.md §1`.

---

## MCP surface

MCP already exists; every current tool answers *"what is true now"*. Add history-shaped tools:

- `history(metric, machine?, since)` → the series
- `findings(open?, severity?, machine?)` → what is broken and since when
- `when_did(metric, crossed)` → "when did free space drop below 40?"
- `diff_state(from, to)` → the query that replaces today's forensics

---

## Build order

✅ **DONE 2026-08-06 — detectors shipped.** `driftScript()` + `parseDrift()` + `DriftFinding`,
wired into `collectMachine()` as one extra SSH call, surfaced via the `drift_findings` MCP tool.
Six rules live: `log.unrotated`, `repo.filter_lost`, `git.orphan_artifacts`,
`pnpm.store_version_drift`, `backup.frozen`, `sqlite.bloated`. 117 tests pass, typecheck clean.

First live fleet run found 3 findings — including an 80 MB orphaned `tmp_pack` on **Jan's** machine,
a rule earned on the M4 that same morning. Cross-machine value on day one.

⚠️ **`swap.regrowth`, `disk.trending_full` and `dupe.real_copies` are NOT shipped** — the first two
need the time series (they are rates, not states) and the third needs the compiled APFS clone probe
on each host. `repo.archived_with_local_commits` needs the GitHub API. Do not assume the detector
list is complete.

**Design note that mattered**: the drift collector is deliberately NOT wrapped in `track()`. For every
other collector an empty result means the SSH call failed; for drift it means *no rule fired*, i.e. a
pass. Wiring it into the `ssh_empty` error path would raise a collection error on a healthy machine.

---

### Remaining build order

1. ~~**Fix AppyRadar's own hygiene first.**~~ **Partly done** — repo unarchived, 9 commits pushed.
   The `sentinal`→`sentinel` rename is still pending; see `migration-sentinal-to-sentinel.md`.
   Original note: Unarchive + rename the repo (see the `sentinal`/`sentinel`
   trap in `disk-maintenance-rules.md` — **the misspelt dir is the live app**), push the 4 local commits.
   A monitor that reported `disk_alert: "ok"` for machines it had never measured has to earn trust back
   before it audits anything else.
2. **Time series only.** Append-only table + `history()`. No detectors. Immediately useful.
3. **Findings table + 3 detectors** — `log.unrotated`, `repo.filter_lost`, `git.orphan_artifacts`.
4. **The rest**, as they earn their place.

---

## Deliberately out of scope

- **Hooks.** *Hooks see your actions; a collector sees the machine.* Nearly every problem this week came
  from another session, a daemon, or accumulated load — invisible to a hook on the operator's session.
  Right tool for "stop David doing X"; wrong tool for "the machine drifted."
- **A rules DSL.** Nine bash predicates do not need a language.
- **Alerting/notifications.** Signal into the time series and let MCP surface it on demand. Push comes later,
  if ever.

---

## This is the product, not an expansion

An earlier draft of this document filed the above as "scope creep — the risk is AppyRadar becomes a
*project* rather than a tool." **That was wrong, and the correction is worth recording.**

AppyRadar's stated purpose is *a radar over every machine, so resource-allocation problems can be
solved.* **Disk is the textbook resource-allocation problem** — a finite pool, many competing
consumers, and decisions about what to evict. Time series over resource consumption, and detectors
that fire when a consumer misbehaves, are not an addition to that mission. They *are* it.

The mistake is worth naming because it is a recurring failure mode when advising: **treating a
product's core purpose as scope creep because the current implementation happens not to cover it
yet.** What exists today (a point-in-time fleet snapshot) is an early slice, not the definition.

The only real discipline needed is implementation restraint — same collector shape, one new table,
nine bash predicates, no DSL. That is a build constraint, not a reason to hesitate.

**Even step 2 alone — the time series, no detectors — would have paid for itself this week.**
