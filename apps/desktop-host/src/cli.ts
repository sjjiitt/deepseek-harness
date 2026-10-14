/** Public dsh commands using the immutable runtime carried by the Desktop installation. */

import { existsSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import { runCli } from '@deepseek-ai/dsh/lib/bin.js'
import { installOfficeEngineResolution, runtimeArchivePath } from './office-engine.ts'

/**
 * Run the ordinary CLI with Desktop's bundled package manager and reserved-profile plugin access.
 * @param runtimeDir - Prepared or ASAR-contained production DSH package tree.
 * @param supportDir - Physical Desktop runtime directory containing the primary-runtime payload and Node launchers.
 * @returns Completion of the selected CLI command; profile plugins own their process lifetime.
 */
export async function runDesktopCli(runtimeDir: string, supportDir: string): Promise<void> {
  installOfficeEngineResolution(runtimeDir)
  await runCli({
    manageDesktopProfile: true,
    packageManager: {
      command: process.execPath,
      args: ['--expose-internals', join(supportDir, 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
        PATH: `${join(supportDir, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      },
    },
  })
}

/**
 * Locate the prepared runtime that carries the primary-runtime payload and Node launchers.
 * A build tree keeps the runtime beside the dsh tree under one target; a packaged application
 * keeps it beside the application tree, one level above the dsh tree's parent.
 * @param runtimeDir - Prepared or ASAR-contained production DSH package tree.
 * @returns Absolute Desktop runtime directory.
 * @throws {Error} When no candidate directory holds a primary-runtime payload.
 */
export function resolveDesktopRuntimeDirectory(runtimeDir: string): string {
  const archive = runtimeArchivePath(runtimeDir)
  const candidates = [
    ...(archive === undefined ? [] : [join(dirname(archive), 'runtime')]),
    join(dirname(runtimeDir), 'runtime'),
    join(dirname(dirname(runtimeDir)), 'runtime'),
  ]
  const found = candidates.find(candidate => existsSync(join(candidate, 'primary-runtime')))
  if (found === undefined) throw new Error(`desktop CLI: no runtime directory found beside ${runtimeDir}`)
  return found
}

if (import.meta.main) {
  if (process.platform === 'win32') {
    const { installWindowsCliSignals } = await import('./windows-cli-signals.ts')
    await installWindowsCliSignals()
  }
  const runtimeDir = resolve(import.meta.dirname, '../../../..')
  await runDesktopCli(runtimeDir, resolveDesktopRuntimeDirectory(runtimeDir))
}
