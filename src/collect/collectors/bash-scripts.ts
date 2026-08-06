/**
 * Bash script templates for the orchestrator-ssh collector.
 *
 * Design rules:
 * - Each function returns a string — no SSH here, fully testable.
 * - Output is key:value or pipe-delimited, with section markers (--- name ---).
 * - Always 2>/dev/null to suppress EACCES/missing-binary noise.
 * - PATH fallbacks for tools not in non-interactive SSH PATH (bun, tailscale, docker).
 *
 * Batching: systemSnapshotScript() combines identity + system + pressure sysctl + disk
 * into one SSH call. See docs/ssh-batching.md for rationale.
 */

import type { AppEntry } from '../../types.js'

// ─── Batched: identity + system + memory_pressure + disk ────────────────────────

/**
 * Compound script: identity, system info, macOS memory pressure (sysctl), and disk.
 * One SSH call instead of four. Fast to run (~1-2s).
 *
 * Section markers: --- identity ---, --- system ---, --- disk ---
 */
export function systemSnapshotScript(): string {
  return `
echo "--- identity ---"
echo "hostname:$(hostname)"
echo "os:$(sw_vers -productVersion 2>/dev/null || uname -s)"
echo "arch:$(uname -m)"
echo "uptime:$(uptime | sed 's/.*up //' | sed 's/, *[0-9]* user.*//')"
echo "user:$(whoami)"
echo "load_1m:$(uptime | grep -oE '[0-9]+\\.[0-9]+' | head -1)"
echo "load_5m:$(uptime | grep -oE '[0-9]+\\.[0-9]+' | sed -n '2p')"

echo "--- system ---"
echo "mem_raw:$(top -l1 -n0 2>/dev/null | grep PhysMem)"
echo "cpu_cores:$(sysctl -n hw.ncpu 2>/dev/null)"
total_ram=$(sysctl -n hw.memsize 2>/dev/null)
[ -n "$total_ram" ] && echo "ram_total_gb:$(echo "$total_ram / 1073741824" | bc)"
# macOS memory pressure level: 1=Normal, 2=Warning, 4=Critical (authoritative sysctl)
echo "memory_pressure_raw:$(sysctl -n kern.memorystatus_vm_pressure_level 2>/dev/null)"

echo "--- disk ---"
df -Pkl 2>/dev/null | awk 'NR>1 && !/devfs/ && !/map / && !/com.apple/ && !/System.Volumes.VM/ && !/System.Volumes.Preboot/ && !/System.Volumes.Update/ && !/System.Volumes.xarts/ && !/System.Volumes.iSCPreboot/ && !/System.Volumes.Hardware/ {
  gsub(/%/, "", $5)
  printf "%s|%s|%s|%s|%s|%s\\n", $1,$2,$3,$4,$5,$6
}'
`
}

// ─── Tools ──────────────────────────────────────────────────────────────────────

/**
 * Collect installed tool versions.
 *
 * PATH fallbacks for tools absent from non-interactive SSH PATH:
 *   bun      → ~/.bun/bin/bun
 *   tailscale → /Applications/Tailscale.app/Contents/MacOS/Tailscale (macOS GUI app)
 *   docker   → /usr/local/bin/docker (Docker Desktop symlink)
 *
 * The helper tries PATH first, then falls back to known install locations.
 */
export function toolsScript(): string {
  return `
_tool_version() {
  local cmd="$1"; shift
  local version_cmd="$@"
  if command -v "$cmd" &>/dev/null; then
    $version_cmd 2>/dev/null | head -1
    return
  fi
  # Fallback to known locations not in non-interactive SSH PATH
  case "$cmd" in
    bun)       local fb="$HOME/.bun/bin/bun"; local fv="$fb --version" ;;
    tailscale) local fb="/Applications/Tailscale.app/Contents/MacOS/Tailscale"; local fv="$fb --version" ;;
    docker)    local fb="/usr/local/bin/docker"; local fv="$fb --version" ;;
    *)         return ;;
  esac
  [ -x "$fb" ] && $fv 2>/dev/null | head -1 || true
}

echo "ruby:$(_tool_version ruby ruby --version)"
echo "node:$(_tool_version node node --version)"
echo "bun:$(_tool_version bun bun --version)"
echo "python3:$(_tool_version python3 python3 --version)"
echo "ansible:$(_tool_version ansible ansible --version)"
echo "git:$(_tool_version git git --version)"
echo "brew:$(_tool_version brew brew --version)"
echo "claude:$(_tool_version claude claude --version)"
echo "tmux:$(_tool_version tmux tmux -V)"
echo "docker:$(_tool_version docker docker --version)"
echo "rbenv:$(_tool_version rbenv rbenv --version)"
echo "ollama:$(_tool_version ollama ollama --version)"
echo "tailscale:$(_tool_version tailscale tailscale --version)"
echo "brew_outdated:$(brew outdated 2>/dev/null | wc -l | tr -d ' ')"
`
}

// ─── Apps ────────────────────────────────────────────────────────────────────────

/** Check whether each app's registered path exists on the remote machine. */
export function appsPathScript(apps: AppEntry[]): string {
  return apps.map(app => {
    const safePath = app.path.replace(/^~/, '$HOME')
    return `[ -d "${safePath}" ] && echo "${app.key}:exists" || echo "${app.key}:missing"`
  }).join('\n')
}

/** List all TCP listening ports in one lsof call. */
export function portsListScript(): string {
  return `
lsof -iTCP -sTCP:LISTEN -Pn -n 2>/dev/null | awk 'NR>1 {
  split($9, a, ":")
  print a[length(a)]
}' | sort -un
`
}

// ─── Relay + OMI (batched) ───────────────────────────────────────────────────────

/** Combined relay folder scan + OMI file count. One SSH instead of two. */
export function relayAndOMIScript(): string {
  return `
echo "--- relay ---"
relay=~/relay
if [ ! -d "$relay" ]; then
  echo "relay_exists:false"
else
  echo "relay_exists:true"
  for folder in "$relay"/*/; do
    [ -d "$folder" ] || continue
    name=$(basename "$folder")
    count=$(find "$folder" -type f 2>/dev/null | wc -l | tr -d ' ')
    last_time=$(stat -f "%Sm" -t "%Y-%m-%d %H:%M" "$folder" 2>/dev/null || echo "")
    echo "folder:$name|$count|$last_time"
  done
  syncthing_pid=$(pgrep -x syncthing 2>/dev/null || echo "")
  echo "syncthing_running:$([ -n "$syncthing_pid" ] && echo true || echo false)"
fi

echo "--- omi ---"
omi=~/dev/raw-intake/omi
if [ ! -d "$omi" ]; then
  echo "omi_exists:false"
else
  total=$(ls "$omi" 2>/dev/null | wc -l | tr -d ' ')
  enriched=$(grep -rl "routing:" "$omi" 2>/dev/null | wc -l | tr -d ' ')
  echo "omi_exists:true"
  echo "omi_total:$total"
  echo "omi_enriched:$enriched"
  echo "omi_pending:$((total - enriched))"
  echo "omi_newest:$(ls -t "$omi" 2>/dev/null | head -1)"
  echo "omi_oldest:$(ls "$omi" 2>/dev/null | head -1)"
  echo "--- monthly ---"
  ls "$omi" 2>/dev/null | grep -oE '^[0-9]{4}-[0-9]{2}' | sort | uniq -c | while read count month; do
    echo "month:$month|$count"
  done
  echo "--- pending_files ---"
  grep -rL "routing:" "$omi" 2>/dev/null | xargs -I{} basename {} | head -10 | while read f; do
    echo "pending_file:$f"
  done
fi
`
}

// ─── Skills + Brains + Ansible (batched) ────────────────────────────────────────

/** Combined skills, brains, and ansible scan. One SSH instead of three. */
export function agentStateScript(): string {
  return `
echo "--- skills ---"
ls ~/.claude/skills/ 2>/dev/null | while read s; do echo "global:$s"; done
ls ~/.claude/plugins/ 2>/dev/null | while read p; do echo "plugin:$p"; done
ls ~/.claude/commands/ 2>/dev/null | while read c; do echo "command:$c"; done
echo "claude_version:$(claude --version 2>/dev/null | head -1 || echo '')"

echo "--- brains ---"
brains=~/dev/ad/brains
if [ ! -d "$brains" ]; then
  echo "brains_exists:false"
else
  echo "brains_exists:true"
  find "$brains" -maxdepth 2 -name "INDEX.md" 2>/dev/null | while read idx; do
    brain=$(dirname "$idx" | xargs basename)
    status=$(awk '/^status:/{print $2; exit}' "$idx" 2>/dev/null)
    activity=$(awk '/^activity_level:/{print $2; exit}' "$idx" 2>/dev/null)
    updated=$(awk '/^last_major_update:/{print $2; exit}' "$idx" 2>/dev/null)
    files=$(awk '/^file_count:/{print $2; exit}' "$idx" 2>/dev/null)
    echo "brain:$brain|$status|$activity|$updated|$files"
  done
fi

echo "--- ansible ---"
ansible_path=~/dev/ad/agent-os/ansible
if [ ! -d "$ansible_path" ]; then
  echo "ansible_exists:false"
else
  echo "ansible_exists:true"
  find "$ansible_path" -maxdepth 1 -name "*.yml" 2>/dev/null | while read f; do
    echo "playbook:$(basename "$f" .yml)"
  done
  find "$ansible_path/roles" -maxdepth 1 -mindepth 1 -type d 2>/dev/null | while read d; do
    echo "role:$(basename "$d")"
  done
  find "$ansible_path/inventory" "$ansible_path/inventory-private" -name "*.yml" -path "*/host_vars/*" 2>/dev/null | while read f; do
    echo "host:$(basename "$f" .yml)"
  done
fi
`
}

// ─── AngelEye ─────────────────────────────────────────────────────────────────

export function angelEyeScript(): string {
  return `
registry="$HOME/.claude/angeleye/registry.json"
if [ ! -f "$registry" ]; then
  echo "installed:false"
  exit 0
fi
echo "installed:true"
lsof -iTCP:5051 -sTCP:LISTEN -Pn -n 2>/dev/null | grep -q . \
  && echo "running:true" || echo "running:false"

python3 - "$registry" <<'PYEOF'
import json, sys
from datetime import datetime, timezone, timedelta

with open(sys.argv[1]) as f:
    data = json.load(f)

sessions = list(data.values())
total    = len(sessions)
active   = sum(1 for s in sessions if s.get('status') == 'active')

now    = datetime.now(timezone.utc)
cutoff = (now - timedelta(hours=24)).isoformat()
recent = [s for s in sessions if (s.get('last_active') or '') >= cutoff]

type_counts = {}
proj_counts = {}
for s in recent:
    t = s.get('session_type') or 'unknown'
    p = s.get('project')      or 'unknown'
    type_counts[t] = type_counts.get(t, 0) + 1
    proj_counts[p] = proj_counts.get(p, 0) + 1

top_proj       = max(proj_counts, key=proj_counts.get) if proj_counts else ''
top_proj_count = proj_counts.get(top_proj, 0)

print('total_sessions:'    + str(total))
print('active_sessions:'   + str(active))
print('sessions_24h:'      + str(len(recent)))
print('top_project:'       + top_proj)
print('top_project_count:' + str(top_proj_count))
for t, c in sorted(type_counts.items(), key=lambda x: -x[1]):
    print('type_' + t.lower() + ':' + str(c))
PYEOF
`
}

// ─── Git repos ────────────────────────────────────────────────────────────────

export function gitReposScript(searchPaths: string[], maxRepos: number): string {
  const searchDirs = searchPaths.join(' ')
  return `
find ${searchDirs} -maxdepth 4 -name ".git" -type d 2>/dev/null | head -${maxRepos} | while read gitdir; do
  repo="\${gitdir%/.git}"
  branch=$(git -C "$repo" branch --show-current 2>/dev/null || echo "")
  dirty=$(git -C "$repo" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
  unpushed=$(git -C "$repo" log --branches --not --remotes --oneline 2>/dev/null | wc -l | tr -d ' ')
  last_commit=$(git -C "$repo" log -1 --format="%cr" 2>/dev/null || echo "")
  remote=$(git -C "$repo" remote get-url origin 2>/dev/null || echo "")
  echo "$repo|$branch|$dirty|$unpushed|$last_commit|$remote"
done
`
}

// ─── Drift detection ────────────────────────────────────────────────────────────

/**
 * Resource-drift predicates. One SSH call, all rules.
 *
 * Every rule below was earned by a real incident, not imagined — see
 * docs/proposal-drift-detection.md for the cost each one carried.
 *
 * ⚠️ COST: these rules walk the filesystem. They are scheduled on their OWN
 *    interval (default 12h) — NOT every collection cycle. See
 *    collect/drift-schedule.ts for why, and bound any new find you add here.
 *
 * Output: one pipe-delimited line per finding
 *   rule|subject|severity|detail
 * No findings = no lines. Silence is a pass.
 *
 * ⚠️ Deliberately excluded, because they cannot be answered by bash-over-SSH
 * at a single point in time:
 *   - swap.regrowth / disk.trending_full  → need the time series (rates, not states)
 *   - dupe.real_copies                    → needs the compiled APFS clone probe
 *   - repo.archived_with_local_commits    → needs the GitHub API
 */
export function driftScript(): string {
  return `
echo "--- drift ---"

# log.unrotated — launchd redirects stdout to a file nothing rotates.
# Measured: 181 MB in 11 days (~21 MB/day, ~7.6 GB/yr) before anyone noticed.
for plist in "$HOME"/Library/LaunchAgents/*.plist; do
  [ -f "$plist" ] || continue
  for key in StandardOutPath StandardErrorPath; do
    lg=$(/usr/bin/plutil -extract "$key" raw "$plist" 2>/dev/null)
    [ -n "$lg" ] && [ -f "$lg" ] || continue
    sz=$(/usr/bin/stat -f '%z' "$lg" 2>/dev/null) || continue
    [ "$sz" -gt 26214400 ] || continue
    age=$(( ( $(date +%s) - $(/usr/bin/stat -f '%B' "$lg" 2>/dev/null || echo 0) ) / 86400 ))
    [ "$age" -lt 1 ] && age=1
    rate=$(( sz / 1048576 / age ))
    echo "log.unrotated|$lg|warning|$(( sz / 1048576 ))MB, ~\${rate}MB/day, no rotation"
  done
done

# repo.filter_lost — --depth 1 does not survive a later fetch; --filter=blob:none does.
# remotion silently regained 5.3 GiB this way after a July cleanup.
for r in "$HOME"/dev/upstream/repos/*/; do
  [ -d "$r/.git" ] || continue
  # du -sk on 115 .git dirs is the third expensive walk. Pack files hold
  # essentially all of a repo's bytes, so summing them is equivalent and cheap.
  gsz=$(/usr/bin/find "$r/.git/objects/pack" -name "*.pack" 2>/dev/null \\
        | /usr/bin/xargs -r /usr/bin/stat -f '%z' 2>/dev/null \\
        | /usr/bin/awk '{s+=$1} END {printf "%d", s/1024}')
  [ -n "$gsz" ] && [ "$gsz" -gt 204800 ] || continue   # only care above 200MB
  prom=$(git -C "$r" config --get remote.origin.promisor 2>/dev/null)
  [ "$prom" = "true" ] && continue
  echo "repo.filter_lost|$(basename "$r")|warning|.git $(( gsz / 1024 ))MB, no blob filter"
done

# git.orphan_artifacts — an interrupted fetch leaves a tmp_pack behind forever. Found one at 2.0 GiB.
# -maxdepth 6 reaches <area>/<repo>/.git/objects/pack/ without descending the
# whole 184 GB tree; -prune skips node_modules and .git interiors where these
# artifacts never appear. Unbounded, this walked millions of inodes per cycle.
/usr/bin/find "$HOME/dev" -maxdepth 6 \\
  \\( -name node_modules -o -name .venv -o -name dist -o -name build \\) -prune -o \\
  -name "tmp_pack_*" -mmin +60 -print 2>/dev/null | while read -r t; do
  echo "git.orphan_artifacts|$t|warning|$(( $(/usr/bin/stat -f '%z' "$t" 2>/dev/null || echo 0) / 1048576 ))MB orphaned"
done

# pnpm.store_version_drift — prune only cleans the store its own version owns.
sc=$(ls -d "$HOME"/Library/pnpm/store/v* 2>/dev/null | wc -l | tr -d ' ')
if [ "\${sc:-0}" -gt 1 ]; then
  vs=$(ls -d "$HOME"/Library/pnpm/store/v* 2>/dev/null | xargs -n1 basename | tr '\\n' ' ')
  tot=$(/usr/bin/du -sk "$HOME"/Library/pnpm/store 2>/dev/null | /usr/bin/awk '{print $1}')
  echo "pnpm.store_version_drift|\${vs}|info|\${sc} stores, $(( \${tot:-0} / 1024 ))MB total — prune once per major"
fi

# backup.frozen — a pre-upgrade snapshot whose mtime stopped moving is dead weight.
for b in "$HOME"/.kyberagent/backups/* "$HOME"/*backup* ; do
  [ -d "$b" ] || continue
  mod=$(( ( $(date +%s) - $(/usr/bin/stat -f '%m' "$b" 2>/dev/null || echo 0) ) / 86400 ))
  [ "$mod" -gt 30 ] || continue
  bsz=$(/usr/bin/du -sk "$b" 2>/dev/null | /usr/bin/awk '{print $1}')
  [ -n "$bsz" ] && [ "$bsz" -gt 512000 ] || continue
  echo "backup.frozen|$b|info|$(( bsz / 1024 ))MB, untouched \${mod}d"
done

# sqlite.bloated — deleted rows never return to the filesystem while auto_vacuum=0.
# Wispr Flow: a 3.26 GiB file holding 0.13 GiB. Invisible to every disk tool.
# -maxdepth 4 covers <App>/<sub>/<sub>/file.sqlite. Opening sqlite3 on every
# large DB is the expensive half, so keep the candidate set small.
/usr/bin/find "$HOME/Library/Application Support" -maxdepth 4 \\
  -name "*.sqlite" -size +500M 2>/dev/null | while read -r db; do
  fl=$(/usr/bin/sqlite3 "$db" "PRAGMA freelist_count;" 2>/dev/null)
  pc=$(/usr/bin/sqlite3 "$db" "PRAGMA page_count;" 2>/dev/null)
  [ -n "$fl" ] && [ -n "$pc" ] && [ "\${pc:-0}" -gt 0 ] || continue
  pct=$(( fl * 100 / pc ))
  [ "$pct" -gt 50 ] || continue
  ps=$(/usr/bin/sqlite3 "$db" "PRAGMA page_size;" 2>/dev/null || echo 4096)
  echo "sqlite.bloated|$db|warning|\${pct}% free pages, $(( fl * ps / 1048576 ))MB reclaimable by VACUUM"
done
`
}
