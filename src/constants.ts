import { join, dirname } from 'path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const PROJECT_ROOT    = join(__dirname, '..')
export const CONFIG_PATH     = join(PROJECT_ROOT, 'sentinel.config.json')
export const SNAPSHOT_DIR    = join(PROJECT_ROOT, 'snapshots')
export const STATE_DIR       = join(PROJECT_ROOT, 'state')
export const SNAPSHOT_LATEST = join(PROJECT_ROOT, 'snapshots', 'sentinel-latest.json')
