# Migration — `sentinal` → `sentinel`

**Status**: planned, not executed. 2026-08-05
**Why**: the misspelling has propagated into a directory name, a GitHub repo, a launchd label, an MCP
server config and ~10 files of app content. It already caused a near-miss where "delete the misspelt
one" would have destroyed the live application.

---

## The trap, stated once

**`appyradar-sentinal` (misspelt) IS the live app.** launchd executes `src/main.ts` from it; the MCP
server loads `src/access/bindings/mcp.ts` from it. **`appyradar-sentinel` (correct) is a 652 KB stub**
with 2 commits and no running code — it exists only because a June rename attempt stalled.

Anyone tidying "the obviously wrong one" deletes production. That is the whole reason this document exists.

---

## Current state

| Thing | Value | Spelling |
|---|---|---|
| Live directory | `~/dev/ad/apps/appyradar-sentinal` | ❌ sentin**a**l |
| Live GitHub repo | `appydave/appyradar-sentinal` | ❌ **and ARCHIVED (read-only)** |
| Stub directory | `~/dev/ad/apps/appyradar-sentinel` | ✅ (652 KB, 2 commits) |
| Stub GitHub repo | `appydave/appyradar-sentinel` | ✅ active — **holds the target name** |
| launchd label | `com.appydave.appyradar-sentinal` | ❌ |
| MCP server name | `appyradar-sentinel` | ✅ — already correct, points at the ❌ path |
| jump alias | `japp-radar` → the live dir | n/a |

Note the MCP server is *already* correctly named while pointing at a misspelt path. Half the rename
happened years-of-context ago and nobody finished it.

---

## Blocker

**The live repo is archived — read-only.** As of 2026-08-05 there are **8 unpushed commits** on this
machine only, including a Collect/Access/Deliver refactor and the MCP command-layer tools. **Nothing
can proceed until it is unarchived, and until then that work has no backup.** This is the highest-risk
item in the whole situation, and it is not a disk problem.

---

## Order of operations

Each step is reversible until step 4.

1. **Unarchive** `appydave/appyradar-sentinal` (GitHub → Settings → Danger Zone). **Push the 8 commits
   immediately** — this alone removes the data-loss risk, independent of any rename.
2. **Free the target name.** `appydave/appyradar-sentinel` currently holds it. It has 2 commits of
   docs; confirm nothing is worth keeping, then rename it to `appyradar-sentinel-stub-retired` (or
   delete). Do **not** delete the local stub dir until the GitHub side is resolved.
3. **Rename the real repo on GitHub** → `appyradar-sentinel`. GitHub preserves history, issues and
   stars, and **leaves a redirect**, so existing remotes keep working — this is why rename beats
   delete-and-recreate.
4. **Local rename**:
   ```bash
   cd ~/dev/ad/apps
   mv appyradar-sentinal appyradar-sentinel-NEW   # stub still occupies the good name
   rm -rf appyradar-sentinel && mv appyradar-sentinel-NEW appyradar-sentinel
   git -C appyradar-sentinel remote set-url origin git@github.com:appydave/appyradar-sentinel.git
   ```
5. **Rewire the five references** (all must change together):
   - `~/Library/LaunchAgents/com.appydave.appyradar-sentinal.plist` — label **and** both log paths.
     `launchctl bootout` the old label before renaming the file, or you get a ghost job.
   - `~/.claude.json` → `.mcpServers.appyradar-sentinel.args[0]` and `.githubRepoPaths`
   - `~/.config/appydave/locations.json` → `app-radar.path` + `git_remote`, then regenerate aliases
     **via the jump skill** (never hand-edit `aliases-jump.zsh`)
   - In-app content: `package.json`, `appysentinel.json`, `README.md`, `CLAUDE.md`, `src/main.ts`,
     `docs/*`, `.mochaccino/*`
   - `~/dev/ad/brains/mac-os/scheduled-jobs-registry.md` and `disk-maintenance-rules.md`
6. **Verify**: `launchctl list | grep appyradar` shows the new label running; the MCP server responds in
   a **fresh** session (MCP servers do not hot-reload); `japp-radar` lands in the right place.

---

## Out of scope — decide separately

`kiros-sentinal` (client repo, active) carries the same misspelling. Whether to standardise the
spelling across client projects is a different decision with a different blast radius. **Do not bundle
it into this migration.**

---

## The rule this earned

> **A rename is only finished when the last reference moves.** A half-finished rename is strictly worse
> than none: it creates two plausible names for one thing, and the *wrong* one keeps working — so
> nothing forces completion, and the next person to tidy up deletes production.

The June attempt created the correct name and stopped. Four months later the misspelt path was still
serving traffic, the correct one was an empty shell, and the real repo had been archived on the
assumption the move had happened.

**Corollary**: never archive the old thing until the new thing is actually serving. Archiving was the
step that turned an untidy rename into 8 unbackable commits.
