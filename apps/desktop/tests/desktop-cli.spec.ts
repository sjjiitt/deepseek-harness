/** The installed CLI uses the shared pnpm distribution with Electron's package-operation environment. */

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { runCli } from '@deepseek-ai/dsh/lib/bin.js'
import { resolveDesktopRuntimeDirectory, runDesktopCli } from '../../desktop-host/src/cli.ts'
import { installOfficeEngineResolution } from '../../desktop-host/src/office-engine.ts'

vi.mock('@deepseek-ai/dsh/lib/bin.js', () => ({ runCli: vi.fn() }))
vi.mock('../../desktop-host/src/office-engine.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../../desktop-host/src/office-engine.ts')>(),
  installOfficeEngineResolution: vi.fn(),
}))

const roots: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Materialize a directory layout and return its temporary root. */
function fixture(layout: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'desktop-cli-'))
  roots.push(root)
  for (const relative of layout) mkdirSync(join(root, relative), { recursive: true })
  return root
}

it('finds the runtime beside the dsh tree of a build target', () => {
  const root = fixture(['dsh/node_modules', 'runtime/primary-runtime'])
  expect(resolveDesktopRuntimeDirectory(join(root, 'dsh'))).toBe(join(root, 'runtime'))
})

it.each(['app.asar', 'app'])('finds the runtime above the %s application tree', (application) => {
  const root = fixture([`resources/${application}/dsh`, 'resources/runtime/primary-runtime'])
  expect(resolveDesktopRuntimeDirectory(join(root, 'resources', application, 'dsh')))
    .toBe(join(root, 'resources', 'runtime'))
})

it('rejects a dsh tree without a runtime directory', () => {
  const root = fixture(['dsh/node_modules'])
  expect(() => resolveDesktopRuntimeDirectory(join(root, 'dsh'))).toThrow(/no runtime directory/u)
})

it.each(['system-bin', undefined])('dispatches with bundled pnpm when PATH is %s', async (path) => {
  vi.stubEnv('PATH', path)
  const runtime = join('Application 中文 with spaces', 'resources', 'app.asar', 'dsh')
  const support = join('Application 中文 with spaces', 'resources', 'runtime')

  await runDesktopCli(runtime, support)

  expect(installOfficeEngineResolution).toHaveBeenCalledExactlyOnceWith(runtime)
  expect(runCli).toHaveBeenCalledExactlyOnceWith({
    manageDesktopProfile: true,
    packageManager: {
      command: process.execPath,
      args: ['--expose-internals', join(support, 'primary-runtime', 'dependencies', 'pnpm', 'bin', 'pnpm.mjs')],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
        PATH: `${join(support, 'bin')}${delimiter}${path ?? ''}`,
      },
    },
  })
})
