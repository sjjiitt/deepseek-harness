/**
 * Build-time brand injection: swap the repository's upstream-only artwork for a
 * deployment's artwork while packaging reads the sources.
 *
 * A branding-removal ruling keeps upstream artwork out of the repository, so a
 * deployment supplies its assets at build time: `DSH_DESKTOP_BRAND_ARCHIVE`
 * points at a zip file or a directory laid out like one, or
 * `DSH_DESKTOP_BRAND_ARCHIVE_BASE64` carries the zip bytes (CI-secret form).
 * `resolveBrandInjection` reads and validates the archive against the brand
 * path whitelist, and `materializeBrandInjection` copies the entries over the
 * repository source paths for the duration of the run; the returned restore
 * function puts the upstream files back (and removes brand-only files), so the
 * working tree is clean after packaging whether it succeeded or failed.
 *
 * Sources are replaced before electron-builder runs — not the unpacked output —
 * because the builder consumes these files several ways that an output-time
 * overwrite cannot reach: the platform `icon` settings render the installer and
 * executable icons, `extraResources` copies the window icon beside the app, and
 * the renderer assets are sealed inside `app.asar` on installed targets.
 */

import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import extractZip from 'extract-zip'

const ARCHIVE_ENV = 'DSH_DESKTOP_BRAND_ARCHIVE'
const ARCHIVE_BASE64_ENV = 'DSH_DESKTOP_BRAND_ARCHIVE_BASE64'

/**
 * Source paths a brand archive may replace, slash-separated and relative to the
 * desktop app root. `brand-favicon-64.png` is the Linux window icon main.ts
 * reads from the packaged resources; `brand-row.png` is a reserved resource
 * slot; the welcome page renders `renderer/assets/welcome-brand.svg`.
 */
export const BRAND_ASSET_PATHS = Object.freeze([
  'resources/icon.png',
  'resources/icon-macos.png',
  'resources/icon-windows.png',
  'resources/brand-favicon-64.png',
  'resources/brand-row.png',
  'renderer/assets/welcome-brand.svg',
])

/** Whitelist entries landing in the packaged resources directory beside `icon.png`. */
const BRAND_RESOURCE_BASENAMES = Object.freeze([
  'brand-favicon-64.png',
  'brand-row.png',
])

/** One validated brand asset: its whitelist path and the bytes to write there. */
/**
 * @typedef {object} BrandEntry
 * @property {string} path - Whitelist path relative to the app root, slash-separated.
 * @property {Buffer} data - File content to materialize.
 */

/**
 * Read the brand archive the environment names, if any.
 * @param {NodeJS.ProcessEnv} env - Packaging environment.
 * @returns {Promise<BrandEntry[] | undefined>} Validated entries, or undefined when no archive is configured.
 */
export async function resolveBrandInjection(env = process.env) {
  const archive = env[ARCHIVE_ENV]?.trim()
  const base64 = env[ARCHIVE_BASE64_ENV]?.trim()
  if (archive && base64) {
    throw new Error(`desktop brand: set ${ARCHIVE_ENV} or ${ARCHIVE_BASE64_ENV}, not both`)
  }
  if (!archive && !base64) return undefined
  const workDir = await mkdtemp(join(tmpdir(), 'desktop-brand-'))
  try {
    const unpacked = join(workDir, 'entries')
    if (base64) {
      const zipPath = join(workDir, 'brand.zip')
      await writeFile(zipPath, Buffer.from(base64, 'base64'))
      await extractZip(zipPath, { dir: unpacked })
    } else {
      const info = await stat(archive)
      if (!info.isFile() && !info.isDirectory()) {
        throw new Error(`desktop brand: ${ARCHIVE_ENV} is neither a zip file nor a directory: ${archive}`)
      }
      if (info.isDirectory()) {
        await copyTree(archive, unpacked)
      } else {
        await extractZip(archive, { dir: unpacked })
      }
    }
    return await collectEntries(unpacked)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

/**
 * Copy a directory tree to a fresh path (a directory-shaped archive source).
 * @param {string} from - Directory to copy.
 * @param {string} to - Destination created by this call.
 * @returns {Promise<void>} Resolves after the copy.
 */
async function copyTree(from, to) {
  const { cp } = await import('node:fs/promises')
  await cp(from, to, { recursive: true })
}

/**
 * Validate the unpacked entries against the whitelist and read their bytes.
 * @param {string} root - Directory holding the unpacked archive entries.
 * @returns {Promise<BrandEntry[]>} One entry per whitelisted file the archive carries.
 */
async function collectEntries(root) {
  const entries = []
  for (const file of await listFiles(root)) {
    const path = relative(root, file).split(sep).join('/')
    if (path === '__MACOSX' || path.startsWith('__MACOSX/') || path === '.DS_Store' || path.endsWith('/.DS_Store')) continue
    if (path === 'renderer/assets/welcome-brand.png') {
      throw new Error('desktop brand: the welcome page renders renderer/assets/welcome-brand.svg, so the archive must replace that .svg (an SVG embedding the PNG works), not a .png')
    }
    if (!BRAND_ASSET_PATHS.includes(path)) {
      throw new Error(`desktop brand: archive entry ${JSON.stringify(path)} is not a brand asset path; allowed: ${BRAND_ASSET_PATHS.join(', ')}`)
    }
    entries.push({ path, data: await readFile(file) })
  }
  if (entries.length === 0) {
    throw new Error(`desktop brand: the archive carries none of the brand asset paths (${BRAND_ASSET_PATHS.join(', ')})`)
  }
  return entries
}

/**
 * List every file under a directory, depth-first.
 * @param {string} root - Directory to walk.
 * @returns {Promise<string[]>} Absolute file paths.
 */
async function listFiles(root) {
  const out = []
  async function walk(dir) {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, item.name)
      if (item.isDirectory()) await walk(full)
      else if (item.isFile()) out.push(full)
    }
  }
  await walk(root)
  return out
}

/**
 * Copy the validated entries over the repository source paths.
 * @param {BrandEntry[]} entries - Validated brand assets.
 * @param {string} appRoot - Desktop application directory the whitelist paths resolve against.
 * @returns {() => void} Restore function putting the upstream tree back; idempotent.
 */
export function materializeBrandInjection(entries, appRoot) {
  const originals = []
  for (const entry of entries) {
    const target = resolve(appRoot, ...entry.path.split('/'))
    if (relative(appRoot, target).startsWith('..')) {
      throw new Error(`desktop brand: entry ${JSON.stringify(entry.path)} escapes the app root`)
    }
    const existed = existsSync(target)
    originals.push({ target, existed, data: existed ? readFileSync(target) : undefined })
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, entry.data)
  }
  process.stdout.write(`desktop brand: injected ${entries.length} asset(s): ${entries.map(entry => entry.path).join(', ')}\n`)
  return () => {
    for (const item of originals) {
      if (item.existed) writeFileSync(item.target, item.data)
      else rmSync(item.target, { force: true })
    }
  }
}

/**
 * The brand resource files a packaged application should carry beside
 * `icon.png`, filtered to the ones present in the repository resources — an
 * unbranded build has none, a branded build has whatever injection materialized.
 * @param {string} resourcesDir - The desktop app's `resources/` source directory.
 * @returns {string[]} Present brand file names.
 */
export function presentBrandResourceFiles(resourcesDir) {
  return BRAND_RESOURCE_BASENAMES.filter(name => existsSync(join(resourcesDir, name)))
}
