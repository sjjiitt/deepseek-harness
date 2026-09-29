/** Run a packaged Windows application from a path its native helpers can read. */
import { randomUUID } from 'node:crypto'
import { mkdirSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, parse, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

/** Repository root; the assembled application is relocated beside it when possible. */
const REPOSITORY_ROOT = resolve(import.meta.dirname, '..', '..', '..')

/** Short path to inspect, plus the disposer that restores the assembled application. */
export interface ShortApplicationPath {
  /** Directory to run the packaged checks from. */
  readonly path: string
  /** Move the assembled application back and remove the temporary parent. */
  readonly dispose: () => Promise<void>
}

/**
 * Move an assembled Windows application to a short path for its packaged checks.
 *
 * LibreOfficeKit's native bootstrap reads its program files through an API bound by the legacy
 * `MAX_PATH` limit, so an application assembled below a deep build directory cannot convert even
 * though every file is present; an installed application lives at a short path. The assembled tree
 * is renamed within the same volume and moved back afterwards, so no bytes are copied and no link
 * can resolve back to the deep path. Candidates are the repository's parent, the system temporary
 * directory, and the application's volume root; an application that cannot move is checked in place.
 * @param application - Assembled application directory.
 * @returns The short directory to inspect, and the disposer that restores the original path.
 */
export function shortApplicationPath(application: string): ShortApplicationPath {
  if (process.platform !== 'win32') return { path: application, dispose: async () => {} }
  const name = `dsh-smoke-${randomUUID().slice(0, 8)}`
  const roots = [join(dirname(REPOSITORY_ROOT), name), join(tmpdir(), name), join(parse(application).root, name)]
  for (const root of roots) {
    try {
      mkdirSync(root)
    } catch {
      continue
    }
    const path = join(root, basename(application))
    try {
      renameSync(application, path)
    } catch {
      rmSync(root, { recursive: true, force: true })
      continue
    }
    return {
      path,
      // A child process can hold handles on the assembled tree for a moment after the checks end,
      // so restoring retries instead of failing a build whose artifacts are already complete.
      dispose: async () => {
        for (let attempt = 0; attempt < 20; attempt++) {
          try {
            renameSync(path, application)
            rmSync(root, { recursive: true, force: true })
            return
          } catch {
            await delay(500)
          }
        }
        console.warn(`desktop smoke: the assembled application remains at ${path}; restore it to ${application}`)
      },
    }
  }
  return { path: application, dispose: async () => {} }
}
