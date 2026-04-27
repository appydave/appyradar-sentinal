/**
 * Atomic file write helper.
 *
 * Pattern: write to a sibling temp file, then `rename` into place. On POSIX
 * filesystems (and APFS / NTFS via Node's promisified fs.rename) this is
 * atomic at the directory-entry level — readers either see the previous
 * version or the new one, never a torn write.
 *
 * Essential for crash safety with flat-file stores (JSONL indexes, registry
 * snapshots, config files).
 */

import { promises as fs } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { randomBytes } from 'node:crypto';

export interface AtomicWriteOptions {
  /** File mode (e.g. 0o600). Defaults to system default. */
  mode?: number;
  /** Encoding for string content. Defaults to 'utf8'. */
  encoding?: BufferEncoding;
  /**
   * fsync the file before rename. Slower but stronger crash guarantee.
   * Defaults to false.
   */
  fsync?: boolean;
}

/**
 * Atomically write content to `path`.
 *
 * Behaviour:
 * 1. Write to `<path>.<random>.tmp` in the same directory.
 * 2. Optionally fsync.
 * 3. `rename` over the destination.
 * 4. On any error, the temp file is removed on a best-effort basis.
 */
export async function atomicWrite(
  path: string,
  content: string | Uint8Array,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const dir = dirname(path);
  const base = basename(path);
  const suffix = randomBytes(6).toString('hex');
  const tmp = join(dir, `.${base}.${suffix}.tmp`);

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(tmp, 'w', options.mode);

    if (typeof content === 'string') {
      await handle.writeFile(content, { encoding: options.encoding ?? 'utf8' });
    } else {
      await handle.writeFile(content);
    }

    if (options.fsync) {
      await handle.sync();
    }

    await handle.close();
    handle = undefined;

    await fs.rename(tmp, path);
  } catch (err) {
    if (handle) {
      try {
        await handle.close();
      } catch {
        /* ignore */
      }
    }
    try {
      await fs.unlink(tmp);
    } catch {
      /* best-effort cleanup */
    }
    throw err;
  }
}
