/** Validate the assembled application, including native Office conversion outside ASAR. */
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { resolveDesktopBuildTarget, resolveDesktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { readDesktopRuntime, verifyDesktopRuntime } from '../src/runtime-tree.ts'
import { shortApplicationPath } from './short-application-path.ts'
import { verifyWindowsCode } from './windows-runtime-signature.mjs'
import { smokePreparedRuntime } from './smoke-prepared-runtime.ts'
import { resolveDesktopPackageTarget } from './package-target.ts'

const paths = resolveDesktopTargetBuildPaths()
const { values } = parseArgs({ options: { unsigned: { type: 'boolean', default: false } }, allowPositionals: false })
const target = resolveDesktopBuildTarget()
const windows = target === 'win-x64'
const linux = target === 'linux-arm64'
const artifacts = values.unsigned ? paths.unsignedArtifacts : paths.artifacts
const application = windows ? join(artifacts, 'win-unpacked')
  : linux ? join(artifacts, 'linux-arm64-unpacked')
    : join(artifacts, target === 'mac-arm64' ? 'mac-arm64' : 'mac', 'DeepSeek Harness.app', 'Contents')
const descriptor = await verifyDesktopRuntime(paths.dsh, readDesktopRuntime(paths.dsh).release.version,
  linux ? { platform: 'linux', arch: 'arm64' } : resolveDesktopPackageTarget(target))
if (windows && !values.unsigned) await verifyWindowsCode(application)
// A Windows assembly is checked through a short path, because the native Office helper cannot
// read its own program directory below a deep build tree.
const inspected = shortApplicationPath(application)
try {
  const resources = join(inspected.path, windows || linux ? 'resources' : 'Resources')
  const executable = windows ? join(inspected.path, 'DeepSeek Harness.exe')
    : linux ? join(inspected.path, 'deepseek-harness')
      : join(inspected.path, 'MacOS', 'DeepSeek Harness')
  // The portable Linux bundle is not archived, so its dsh tree sits beside app.asar's usual directory.
  await smokePreparedRuntime(join(resources, linux ? 'app' : 'app.asar', 'dsh'), executable, join(resources, 'runtime'), descriptor)
} finally {
  await inspected.dispose()
}
