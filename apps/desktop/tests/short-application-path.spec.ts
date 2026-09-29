import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { shortApplicationPath } from '../scripts/short-application-path.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function assembly(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'short-application-'))
  roots.push(root)
  const application = join(root, 'deep', 'win-unpacked')
  await mkdir(application, { recursive: true })
  await writeFile(join(application, 'marker.txt'), 'assembled')
  return application
}

it.runIf(process.platform === 'win32')('checks a Windows assembly from a short path and restores it', async () => {
  const application = await assembly()
  const inspected = shortApplicationPath(application)
  try {
    expect(inspected.path).not.toBe(application)
    expect(existsSync(application)).toBe(false)
    expect(await readFile(join(inspected.path, 'marker.txt'), 'utf8')).toBe('assembled')
  } finally {
    await inspected.dispose()
  }
  expect(await readFile(join(application, 'marker.txt'), 'utf8')).toBe('assembled')
})

it.runIf(process.platform !== 'win32')('inspects other assemblies in place', async () => {
  const application = await assembly()
  const inspected = shortApplicationPath(application)
  expect(inspected.path).toBe(application)
  expect(existsSync(application)).toBe(true)
  await inspected.dispose()
  expect(await readFile(join(application, 'marker.txt'), 'utf8')).toBe('assembled')
})
