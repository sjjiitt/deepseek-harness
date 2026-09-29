import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BRAND_ASSET_PATHS,
  materializeBrandInjection,
  presentBrandResourceFiles,
  resolveBrandInjection,
} from '../scripts/brand-assets.mjs'

const FIXTURE_ZIP = join(import.meta.dirname, 'fixtures', 'brand-assets', 'brand-sample.zip')
const cleanup: string[] = []

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  cleanup.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('resolveBrandInjection', () => {
  it('returns undefined when no archive variable is set', async () => {
    await expect(resolveBrandInjection({})).resolves.toBeUndefined()
    await expect(resolveBrandInjection({ DSH_DESKTOP_BRAND_ARCHIVE: '', DSH_DESKTOP_BRAND_ARCHIVE_BASE64: '' })).resolves.toBeUndefined()
  })

  it('rejects setting both archive variables', async () => {
    await expect(resolveBrandInjection({
      DSH_DESKTOP_BRAND_ARCHIVE: FIXTURE_ZIP,
      DSH_DESKTOP_BRAND_ARCHIVE_BASE64: 'AAAA',
    })).rejects.toThrow('not both')
  })

  it('reads a zip archive into whitelist entries', async () => {
    const entries = await resolveBrandInjection({ DSH_DESKTOP_BRAND_ARCHIVE: FIXTURE_ZIP })
    expect(entries?.map(entry => entry.path).sort()).toEqual([
      'resources/brand-favicon-64.png',
      'resources/brand-row.png',
    ])
    expect(entries?.[0]?.data.length).toBeGreaterThan(0)
  })

  it('reads a base64 zip', async () => {
    const entries = await resolveBrandInjection({
      DSH_DESKTOP_BRAND_ARCHIVE_BASE64: readFileSync(FIXTURE_ZIP).toString('base64'),
    })
    expect(entries?.map(entry => entry.path).sort()).toEqual([
      'resources/brand-favicon-64.png',
      'resources/brand-row.png',
    ])
  })

  it('reads a directory source laid out like an archive', async () => {
    const dir = await tempDir('brand-dir-')
    await mkdir(join(dir, 'resources'), { recursive: true })
    await writeFile(join(dir, 'resources', 'brand-row.png'), Buffer.from('row'))
    await writeFile(join(dir, '.DS_Store'), Buffer.from('junk'))
    const entries = await resolveBrandInjection({ DSH_DESKTOP_BRAND_ARCHIVE: dir })
    expect(entries).toEqual([{ path: 'resources/brand-row.png', data: Buffer.from('row') }])
  })

  it('rejects a welcome png with the svg guidance', async () => {
    const dir = await tempDir('brand-welcome-')
    await mkdir(join(dir, 'renderer', 'assets'), { recursive: true })
    await writeFile(join(dir, 'renderer', 'assets', 'welcome-brand.png'), Buffer.from('png'))
    await expect(resolveBrandInjection({ DSH_DESKTOP_BRAND_ARCHIVE: dir }))
      .rejects.toThrow('renderer/assets/welcome-brand.svg')
  })

  it('rejects entries outside the whitelist', async () => {
    const dir = await tempDir('brand-foreign-')
    await mkdir(join(dir, 'resources'), { recursive: true })
    await writeFile(join(dir, 'resources', 'installer-sidebar.bmp'), Buffer.from('x'))
    await expect(resolveBrandInjection({ DSH_DESKTOP_BRAND_ARCHIVE: dir }))
      .rejects.toThrow('not a brand asset path')
  })

  it('rejects an archive carrying no brand entries', async () => {
    const dir = await tempDir('brand-empty-')
    await mkdir(join(dir, 'resources'), { recursive: true })
    await writeFile(join(dir, 'resources', '.DS_Store'), Buffer.from('junk'))
    await expect(resolveBrandInjection({ DSH_DESKTOP_BRAND_ARCHIVE: dir }))
      .rejects.toThrow('carries none of the brand asset paths')
  })

  it('reports a missing archive file', async () => {
    const missing = join(await tempDir('brand-missing-'), 'absent.zip')
    await expect(resolveBrandInjection({ DSH_DESKTOP_BRAND_ARCHIVE: missing }))
      .rejects.toThrow()
  })

  it('exposes exactly the documented whitelist', () => {
    expect(BRAND_ASSET_PATHS).toEqual([
      'resources/icon.png',
      'resources/icon-macos.png',
      'resources/icon-windows.png',
      'resources/brand-favicon-64.png',
      'resources/brand-row.png',
      'renderer/assets/welcome-brand.svg',
    ])
  })
})

describe('materializeBrandInjection', () => {
  it('overwrites existing files, creates new ones, and restores both', async () => {
    const appRoot = await tempDir('brand-materialize-')
    await mkdir(join(appRoot, 'resources'), { recursive: true })
    await writeFile(join(appRoot, 'resources', 'icon.png'), Buffer.from('upstream'))
    const entries = [
      { path: 'resources/icon.png', data: Buffer.from('branded') },
      { path: 'resources/brand-row.png', data: Buffer.from('row') },
    ]
    const restore = materializeBrandInjection(entries, appRoot)
    expect(readFileSync(join(appRoot, 'resources', 'icon.png'))).toEqual(Buffer.from('branded'))
    expect(readFileSync(join(appRoot, 'resources', 'brand-row.png'))).toEqual(Buffer.from('row'))
    restore()
    expect(readFileSync(join(appRoot, 'resources', 'icon.png'))).toEqual(Buffer.from('upstream'))
    expect(existsSync(join(appRoot, 'resources', 'brand-row.png'))).toBe(false)
  })

  it('is safe to call the restore function twice', async () => {
    const appRoot = await tempDir('brand-restore-twice-')
    await mkdir(join(appRoot, 'resources'), { recursive: true })
    await writeFile(join(appRoot, 'resources', 'brand-row.png'), Buffer.from('row'))
    const restore = materializeBrandInjection(
      [{ path: 'resources/brand-row.png', data: Buffer.from('branded') }], appRoot)
    restore()
    restore()
    expect(readFileSync(join(appRoot, 'resources', 'brand-row.png'))).toEqual(Buffer.from('row'))
  })

  it('creates missing parent directories for renderer assets', async () => {
    const appRoot = await tempDir('brand-renderer-')
    const restore = materializeBrandInjection(
      [{ path: 'renderer/assets/welcome-brand.svg', data: Buffer.from('<svg/>') }], appRoot)
    expect(readFileSync(join(appRoot, 'renderer', 'assets', 'welcome-brand.svg'))).toEqual(Buffer.from('<svg/>'))
    restore()
    expect(existsSync(join(appRoot, 'renderer', 'assets', 'welcome-brand.svg'))).toBe(false)
  })
})

describe('presentBrandResourceFiles', () => {
  it('lists only the brand files that exist', async () => {
    const dir = await tempDir('brand-present-')
    await mkdir(dir, { recursive: true })
    expect(presentBrandResourceFiles(dir)).toEqual([])
    await writeFile(join(dir, 'brand-favicon-64.png'), Buffer.from('x'))
    expect(presentBrandResourceFiles(dir)).toEqual(['brand-favicon-64.png'])
  })
})
