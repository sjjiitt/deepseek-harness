import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { patchOfficeEngineAsar } from '../scripts/office-engine-asar.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** Published kit shape the rewrite must recognize, reduced to the reviewed regions. */
const KIT = [
  'async function engineAsset(root, value, name, kind) {',
  '\treturn path;',
  '}',
  'async function runNative(engine, options, input, output, profile, fonts, substitutions, signal, operation = {',
  '\tconst child = spawn(engine.executable, [',
  '\t\t"--program-directory",',
  '\t\tengine.programDirectory,',
  '\t], {',
  '\t\tstdio: [',
  '\t\t\t"ignore",',
  '\t\t\t"pipe",',
  '\t\t\t"pipe"',
  '\t\t],',
  '\t\twindowsHide: true,',
  '\t\tenv',
  '\t});',
  '\tif (code !== 0 || result.ok !== true) throw new ConversionError(failureCode(result), `LibreOffice native conversion failed: ${result.error ?? stderr}`);',
  '}',
  'function renderFailure(result, stderr) {',
  '\treturn new ConversionError(failureCode(result), `LibreOffice native rendering failed: ${result.error ?? stderr}`);',
  '}',
  'async function readEngine(packageFile, backend, target) {',
  '\tconst root = dirname(packageFile);',
  '\treturn root;',
  '}',
  '',
].join('\n')

async function fixture(source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'office-engine-asar-'))
  roots.push(root)
  await mkdir(join(root, 'lib'), { recursive: true })
  await writeFile(join(root, 'lib', 'index.js'), source)
  return root
}

it('runs the helper from a physical engine directory with its own diagnostics', async () => {
  const directory = await fixture(KIT)
  patchOfficeEngineAsar(directory)
  const patched = await readFile(join(directory, 'lib', 'index.js'), 'utf8')
  // The engine root falls back to the physical copy beside an archive.
  expect(patched).toContain('async function physicalEngineRoot(resolved) {')
  expect(patched).toContain('const root = await physicalEngineRoot(dirname(packageFile));')
  expect(patched).toContain('return status.isDirectory() ? unpacked : resolved;')
  // The helper inherits the engine's own program directory, not the application's.
  expect(patched).toContain('cwd: engine.programDirectory,')
  // A conversion failure keeps a bounded tail of the helper's output.
  expect(patched).toContain('function nativeDiagnostic(stderr) {')
  expect(patched).toContain('${result.error ?? stderr}${nativeDiagnostic(stderr)}')
  expect(patched.split('${result.error ?? stderr}${nativeDiagnostic(stderr)}')).toHaveLength(3)
  expect(patched).toContain('async function readEngine(packageFile, backend, target) {')
})

it('leaves an already patched kit unchanged', async () => {
  const directory = await fixture(KIT)
  patchOfficeEngineAsar(directory)
  const once = await readFile(join(directory, 'lib', 'index.js'), 'utf8')
  patchOfficeEngineAsar(directory)
  expect(await readFile(join(directory, 'lib', 'index.js'), 'utf8')).toBe(once)
})

it('rejects an installed kit whose source no longer matches', async () => {
  const directory = await fixture('export const changed = 1\n')
  expect(() => { patchOfficeEngineAsar(directory) }).toThrow(/reviewed LibreOffice kit source/u)
})
