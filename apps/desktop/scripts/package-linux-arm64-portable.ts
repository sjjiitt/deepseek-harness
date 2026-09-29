/**
 * Build the self-contained Linux arm64 Desktop portable directory.
 *
 * This is not a signed release target: it has no update feed and no mandatory
 * policy, and it packages an unpacked application directory rather than an
 * installer. Preparation reuses the shared Electron, primary-runtime and dsh
 * steps; electron-builder only assembles the application tree, and the script
 * archives that tree as a tar.gz beside a launcher and a bundle README.
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { basename, join, resolve } from 'node:path'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { desktopTargetBuildPaths } from './desktop-build-paths.mjs'
import { materializeBrandInjection, resolveBrandInjection } from './brand-assets.mjs'

const APP_ROOT = resolve(import.meta.dirname, '..')
const REPOSITORY_ROOT = resolve(APP_ROOT, '..', '..')
const TARGET = 'linux-arm64'
const DEFAULT_APP_ID = 'com.deepseek.harness'

/**
 * Read the product version the bundle carries.
 * @returns Desktop package version.
 */
function productVersion(): string {
  const manifest = JSON.parse(readFileSync(join(APP_ROOT, 'package.json'), 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string' || manifest.version === '') {
    throw new Error('desktop portable: the desktop package has no version')
  }
  return manifest.version
}

/**
 * Run one package-manager command through the invoking pnpm entry.
 * @param args - Arguments after the pnpm entry point.
 * @param environment - Packaging environment shared by every preparation step.
 * @param cwd - Directory the command runs in.
 * @returns Nothing.
 */
function pnpm(args: readonly string[], environment: NodeJS.ProcessEnv, cwd: string): void {
  const entry = process.env.npm_execpath
  if (entry === undefined || entry === '') {
    throw new Error('desktop portable: invoke this script through a pnpm package command')
  }
  const result = spawnSync(process.execPath, [entry, ...args], { cwd, env: environment, stdio: 'inherit' })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`desktop portable: pnpm ${args.join(' ')} exited with ${String(result.status ?? result.signal)}`)
  }
}

/**
 * Launcher written beside the packaged application.
 * @returns The shell script installed as `run-deepseek-harness.sh`.
 */
export function portableLauncher(): string {
  return `#!/bin/sh
# Launch the packaged DeepSeek Harness application from this directory.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
# Kylin and other desktops export canberra-gtk-module through GTK_MODULES, and this bundle carries no
# such module: GTK reports a failed module load on every launch. Keep the accessibility bridge, which
# needs the session bus rather than a module the host may lack, and let a deployment name its own
# list when it ships the module.
GTK_MODULES="\${DSH_DESKTOP_GTK_MODULES:-gail:atk-bridge}"
export GTK_MODULES
# Chromium starts a GPU process while it initializes and leaves a blank window when none can start,
# which is what a GPU-less host reports. A host with no DRM render node has no device to accelerate
# through, so select the CPU path before the shell reads the variable; an explicit
# DSH_DESKTOP_SOFTWARE_RENDERING still wins.
if [ -z "\${DSH_DESKTOP_SOFTWARE_RENDERING:-}" ] && [ ! -e /dev/dri/renderD128 ]; then
  DSH_DESKTOP_SOFTWARE_RENDERING=1
  export DSH_DESKTOP_SOFTWARE_RENDERING
fi
# Keep the renderer responsive when the window is occluded, minimized, or software rendered:
# Chromium otherwise throttles timers there and the Host terminates the heartbeat-starved socket.
flags="--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --class=deepseek-harness"
if [ "\${DSH_DESKTOP_NO_SANDBOX:-0}" = 1 ]; then
  flags="$flags --no-sandbox"
fi
# shellcheck disable=SC2086 # flags is an intentional word-split list.
exec "$here/deepseek-harness" $flags "$@"
`
}

/**
 * Launcher installer written beside the packaged application. It writes a
 * freedesktop entry for this bundle so a double-click or the application menu
 * starts the window without spawning a terminal.
 */
const DESKTOP_ENTRY_INSTALLER = `#!/bin/sh
# Install a launcher for this bundle so it opens from a double-click or the
# application menu without a terminal window.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
case "$here" in
  *'"'*) echo "install-desktop-entry: the bundle path must not contain a double quote" >&2; exit 2 ;;
esac
launcher="$here/run-deepseek-harness.sh"
icon="$here/resources/app-icon.png"
entry="$here/deepseek-harness.desktop"

if [ ! -x "$launcher" ]; then
  echo "install-desktop-entry: $launcher is missing or not executable" >&2
  exit 2
fi

cat > "$entry" <<EOF
[Desktop Entry]
Type=Application
Version=1.0
Name=DeepSeek Harness
Comment=DeepSeek Harness desktop application
Comment[zh_CN]=DeepSeek Harness 桌面应用
Exec="$launcher"
Path=$here
Icon=$icon
Terminal=false
Categories=Utility;Development;
StartupNotify=true
StartupWMClass=deepseek-harness
EOF
chmod 0755 "$entry"

trust() {
  command -v gio >/dev/null 2>&1 || return 0
  gio set -t string "$1" metadata::trusted true 2>/dev/null || true
}

install_into() {
  [ -d "$1" ] || return 0
  cp -f "$entry" "$1/deepseek-harness.desktop"
  chmod 0755 "$1/deepseek-harness.desktop"
  trust "$1/deepseek-harness.desktop"
  echo "installed $1/deepseek-harness.desktop"
}

trust "$entry"
echo "wrote $entry"

applications="\${XDG_DATA_HOME:-$HOME/.local/share}/applications"
if mkdir -p "$applications" 2>/dev/null; then
  install_into "$applications"
  update-desktop-database "$applications" >/dev/null 2>&1 || true
fi

# Kylin and other desktops localize the directory name, so cover both spellings.
install_into "$HOME/Desktop"
install_into "$HOME/桌面"

echo
echo "Double-click the installed launcher to start DeepSeek Harness without a terminal."
`

/**
 * Installer shipped inside the application update archive.
 *
 * The archive carries `resources/app` and `resources/runtime/cli` only, so the replacement keeps
 * every runtime directory the target host already deployed and stores the previous application
 * beside it for a rollback.
 * @returns The shell script installed as `install-app-update.sh`.
 */
export function appUpdateInstaller(): string {
  return `#!/bin/sh
# Replace the application code of an installed DeepSeek Harness bundle.
#
# This archive carries resources/app and resources/runtime/cli only: Electron, the bundled Python
# distribution and the pnpm CLI stay exactly as deployed.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <bundle-directory>" >&2
  echo "       <bundle-directory> holds run-deepseek-harness.sh" >&2
  exit 2
fi

bundle=$1
if [ ! -d "$bundle/resources/app" ]; then
  echo "install-app-update: $bundle/resources/app is missing; is that a DeepSeek Harness bundle?" >&2
  exit 2
fi
if [ ! -d "$here/resources/app" ]; then
  echo "install-app-update: unpack this archive before running this script" >&2
  exit 2
fi

stamp=$(date +%Y%m%d%H%M%S)
backup="$bundle/resources/app.backup.$stamp"
echo "install-app-update: keeping the current application at $backup"
mv "$bundle/resources/app" "$backup"
cp -a "$here/resources/app" "$bundle/resources/app"
if [ -d "$here/resources/runtime/cli" ]; then
  if [ -d "$bundle/resources/runtime/cli" ]; then
    mv "$bundle/resources/runtime/cli" "$bundle/resources/runtime/cli.backup.$stamp"
  fi
  mkdir -p "$bundle/resources/runtime"
  cp -a "$here/resources/runtime/cli" "$bundle/resources/runtime/cli"
fi

if [ -f "$bundle/resources/runtime/cli/bin/dsh" ]; then
  # Keep the CLI entry executable even where the copy could not carry the mode over.
  chmod 0755 "$bundle/resources/runtime/cli/bin/dsh"
fi

echo "install-app-update: application replaced; start the bundle again to use it"
echo "install-app-update: to roll back, remove resources/app and rename $backup back"
`
}

/**
 * Compose the README shipped inside the application update archive.
 * @param version - Product version the update carries.
 * @returns Markdown README written beside the installer.
 */
function appUpdateReadme(version: string): string {
  return `# DeepSeek Harness Desktop ${version} — application update (Linux arm64)

This archive replaces the application code of a bundle that is already deployed.
It carries \`resources/app\` (the shell and the dsh runtime tree) and
\`resources/runtime/cli\`; Electron, the bundled Python distribution and the pnpm
CLI are not included, because the target machine already has them.

Unpack it and point the installer at the bundle directory:

\`\`\`sh
tar -xzf deepseek-harness-${version}-linux-arm64-app.tar.gz
cd deepseek-harness-${version}-linux-arm64-app
./install-app-update.sh /path/to/deepseek-harness-${version}-linux-arm64
\`\`\`

The installer moves the replaced directories aside as
\`app.backup.<timestamp>\`, so a rollback removes \`resources/app\` and renames that
backup back. Use this archive for a bundle of the same product line: the native
addons inside \`app\` are built against the Electron version that bundle ships.
`
}

/**
 * Compose the bundle README for one version.
 * @param version - Product version the bundle carries.
 * @returns Markdown README written into the bundle root.
 */
function bundleReadme(version: string): string {
  return `# DeepSeek Harness Desktop ${version} (Linux arm64)

Unpack anywhere and run:

\`\`\`sh
./run-deepseek-harness.sh
\`\`\`

To open the application from a desktop icon instead, install the bundled
launcher once:

\`\`\`sh
./install-desktop-entry.sh
\`\`\`

It writes \`deepseek-harness.desktop\` beside the bundle, registers it in the
application menu, and places a copy on the desktop. The entry starts the window
directly, without a terminal.

The bundle is self-contained: it carries Electron, the dsh runtime, and the
bundled Python and pnpm distributions, so nothing is installed on the host.
Startup requires no network access; automatic updates and the mandatory-update
policy are disabled in this build.

State lives under \`$DSH_HOME\` (default \`~/.dsh\`): sessions, settings,
credentials, plugins, and workspaces. Export \`DSH_HOME\` first to keep that
state elsewhere.

Requirements: Linux arm64 with glibc 2.28 or newer (Kylin V10 SP1 and
compatible). Every bundled program references no GLIBC symbol newer than 2.28;
the desktop environment still supplies the usual Electron libraries such as
libnss3, libgbm, and libasound2.

The launcher replaces the desktop's GTK module list, because Kylin exports
\`canberra-gtk-module\` and this bundle does not carry it; GTK otherwise reports
a failed module load on every launch. Export \`DSH_DESKTOP_GTK_MODULES\` to keep a
module the deployment needs.

Rendering follows the host: a machine without a DRM render node
(\`/dev/dri/renderD128\`) starts on the CPU path, because Chromium otherwise fails
to start a GPU process and can leave the window blank. Export
\`DSH_DESKTOP_SOFTWARE_RENDERING\` to \`0\` or \`1\` to decide it explicitly.

If the application reports a Chromium sandbox error, either prepare the setuid
helper once as root:

\`\`\`sh
sudo chown root:root chrome-sandbox
sudo chmod 4755 chrome-sandbox
\`\`\`

or launch without the Chromium sandbox:

\`\`\`sh
DSH_DESKTOP_NO_SANDBOX=1 ./run-deepseek-harness.sh
\`\`\`
`
}

async function main(): Promise<void> {
  if (process.platform !== 'linux' || process.arch !== 'arm64') {
    throw new Error('desktop portable: linux-arm64 portable packaging requires a Linux arm64 build host')
  }
  const version = productVersion()
  const paths = desktopTargetBuildPaths(TARGET)
  const environment: NodeJS.ProcessEnv = {
    ...process.env,
    DSH_DESKTOP_TARGET_PLATFORM: 'linux',
    DSH_DESKTOP_TARGET_ARCH: 'arm64',
    DSH_DESKTOP_PORTABLE: '1',
    DSH_DESKTOP_APP_ID: process.env.DSH_DESKTOP_APP_ID?.trim() || DEFAULT_APP_ID,
  }
  // Brand assets replace repository sources only for this run; a failure still
  // restores the upstream artwork (see restoreBrand in the finally below).
  const brand = await resolveBrandInjection(environment)
  const restoreBrand = brand === undefined ? undefined : materializeBrandInjection(brand, APP_ROOT)
  try {
    pnpm(['run', 'build:official'], environment, REPOSITORY_ROOT)
    pnpm(['run', 'release:pack', '--family', 'dsh', '--out', paths.packedDsh], environment, REPOSITORY_ROOT)
    pnpm(['--dir', 'apps/desktop-host', 'pack', '--pack-destination', paths.packedDsh], environment, REPOSITORY_ROOT)
    pnpm(['run', 'release:pack', '--family', 'vendor', '--out', paths.packedVendor], environment, REPOSITORY_ROOT)
    rmSync(paths.packedLandlock, { recursive: true, force: true })
    mkdirSync(paths.packedLandlock, { recursive: true })
    pnpm(['--dir', 'native/system', 'run', 'build:ts'], environment, REPOSITORY_ROOT)
    pnpm(['--dir', 'native/system/packages/entry', 'pack', '--pack-destination', paths.packedLandlock], environment, REPOSITORY_ROOT)
    pnpm(['run', 'prepare:runtime'], environment, APP_ROOT)
    pnpm(['run', 'prepare:packages'], environment, APP_ROOT)
    // The post-package smoke (smoke-packaged-runtime) exercises the Office
    // conversion on the assembled tree, so the prepared-runtime Office smoke here
    // repeated it on every packaging run for ~65 s; defer it to that single pass.
    pnpm(['run', 'prepare:dsh', '--defer-runtime-smoke'], environment, APP_ROOT)
    // The package's TypeScript project is already built by build:official, so only its bundler runs:
    // the root workspace build leaves workspace imports external, which the packaged application
    // cannot resolve, while the package's own bundling inlines them and leaves only production
    // dependencies that electron-builder ships.
    pnpm(['exec', 'tsdown'], environment, APP_ROOT)
    rmSync(paths.artifacts, { recursive: true, force: true })
    pnpm([
      'exec', 'electron-builder', '--config', 'electron-builder.config.mjs',
      '--linux', '--arm64', '--dir', '--publish', 'never',
    ], environment, APP_ROOT)
    pnpm(['exec', 'tsx', 'scripts/smoke-packaged-runtime.ts'], environment, APP_ROOT)

    const bundleName = `deepseek-harness-${version}-linux-arm64`
    const portableRoot = join(paths.artifacts, 'portable')
    const bundleRoot = join(portableRoot, bundleName)
    const unpacked = ['linux-arm64-unpacked', 'linux-unpacked']
      .map(name => join(paths.artifacts, name))
      .find(candidate => existsSync(candidate))
    if (unpacked === undefined) {
      throw new Error('desktop portable: electron-builder produced no unpacked application directory')
    }
    rmSync(portableRoot, { recursive: true, force: true })
    mkdirSync(portableRoot, { recursive: true })
    renameSync(unpacked, bundleRoot)
    // The Linux window manager reads the square icon beside the packaged app; the desktop entry and
    // the launcher resolve it from `resources/`. A deployment that injects its own artwork replaces
    // this source file through the brand-asset materialization step.
    copyFileSync(join(APP_ROOT, 'resources', 'icon.png'), join(bundleRoot, 'resources', 'app-icon.png'))
    writeFileSync(join(bundleRoot, 'run-deepseek-harness.sh'), portableLauncher(), { mode: 0o755 })
    writeFileSync(join(bundleRoot, 'install-desktop-entry.sh'), DESKTOP_ENTRY_INSTALLER, { mode: 0o755 })
    writeFileSync(join(bundleRoot, 'README.md'), bundleReadme(version))
    const tarball = join(portableRoot, `${bundleName}.tar.gz`)
    execFileSync('tar', ['-C', portableRoot, '-czf', tarball, bundleName], { stdio: 'inherit' })
    const digest = execFileSync('sha256sum', [tarball], { encoding: 'utf8' }).split(/\s+/u)[0]
    writeFileSync(`${tarball}.sha256`, `${digest ?? ''}  ${basename(tarball)}\n`)
    process.stdout.write(`desktop portable: ${tarball}\n`)
    process.stdout.write(`desktop portable: ${tarball}.sha256\n`)

    // The target host already deployed the runtime directories, so an update ships the application
    // tree alone: `resources/app` plus the CLI scripts, which are application code as well. The
    // payload is hard-linked into the staging directory, so staging costs no extra space.
    const updateName = `${bundleName}-app`
    const updateRoot = join(portableRoot, updateName)
    rmSync(updateRoot, { recursive: true, force: true })
    mkdirSync(join(updateRoot, 'resources', 'runtime'), { recursive: true })
    writeFileSync(join(updateRoot, 'install-app-update.sh'), appUpdateInstaller(), { mode: 0o755 })
    writeFileSync(join(updateRoot, 'README.md'), appUpdateReadme(version))
    execFileSync('cp', ['-al', join(bundleRoot, 'resources', 'app'), join(updateRoot, 'resources', 'app')], { stdio: 'inherit' })
    execFileSync('cp', ['-al', join(bundleRoot, 'resources', 'runtime', 'cli'), join(updateRoot, 'resources', 'runtime', 'cli')], { stdio: 'inherit' })
    const updateTarball = join(portableRoot, `${updateName}.tar.gz`)
    execFileSync('tar', ['-czf', updateTarball, '-C', portableRoot, updateName], { stdio: 'inherit' })
    rmSync(updateRoot, { recursive: true, force: true })
    const updateDigest = execFileSync('sha256sum', [updateTarball], { encoding: 'utf8' }).split(/\s+/u)[0]
    writeFileSync(`${updateTarball}.sha256`, `${updateDigest ?? ''}  ${basename(updateTarball)}\n`)
    process.stdout.write(`desktop portable: ${updateTarball}\n`)
    process.stdout.write(`desktop portable: ${updateTarball}.sha256\n`)
  } finally {
    restoreBrand?.()
  }
}

if (process.argv[1] !== undefined && import.meta.filename === resolve(process.argv[1])) await main()
