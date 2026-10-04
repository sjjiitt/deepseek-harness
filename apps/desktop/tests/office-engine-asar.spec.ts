import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { patchOfficeEngineAsar } from '../scripts/office-engine-asar.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

/** Published kit shape the rewrite must recognize, reduced to the reviewed regions. */
const KIT = [
  'function spawnNative(executable, args, env) {',
  '\tif (process.platform !== "win32") return spawn(executable, args, {',
  '\t\tstdio: "pipe",',
  '\t\twindowsHide: true,',
  '\t\tenv',
  '\t});',
  '\ttry {',
  '\t\tchild = spawn(executable, args, {',
  '\t\t\tstdio: [',
  '\t\t\t\tinput.read,',
  '\t\t\t\toutput.write,',
  '\t\t\t\terror.write',
  '\t\t\t],',
  '\t\t\twindowsHide: true,',
  '\t\t\tenv',
  '\t\t});',
  '\t} catch (error) {',
  '\t\tthrow error;',
  '\t}',
  '}',
  'async function runNative(engine, options, input, output, profile, fonts, substitutions, signal, operation = {',
  '\tconst child = spawnNative(engine.executable, [',
  '\t\t"--program-directory",',
  '\t\tengine.programDirectory,',
  '\t\t...fonts.flatMap((path) => ["--font-file", path])',
  '\t\t], env);',
  '\tif (code !== 0 || result.ok !== true) throw new ConversionError(failureCode(result), `LibreOffice native conversion failed: ${result.error ?? stderr}`);',
  '}',
  'async function renderImagesWithNative(request) {',
  '\tconst child = spawnNative(engine.executable, [',
  '\t\t"--operation",',
  '\t\t"render-images",',
  '\t\t], nativeEnvironment(profile, engine.programDirectory));',
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

/** Resolve the installed kit through the Host package that declares it, or undefined when it is absent. */
function installedKit(): string | undefined {
  try {
    const hostRequire = createRequire(fileURLToPath(new URL('../../desktop-host/package.json', import.meta.url)))
    return dirname(hostRequire.resolve('@deepseek-ai/libreoffice-kit/package.json'))
  } catch {
    return undefined
  }
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
  expect(patched).toContain('function spawnNative(executable, args, env, cwd) {')
  expect(patched).toContain('\t\tstdio: "pipe",\n\t\twindowsHide: true,\n\t\tcwd,\n\t\tenv\n\t});')
  expect(patched).toContain('\t\t\twindowsHide: true,\n\t\t\tcwd,\n\t\t\tenv\n\t\t});')
  expect(patched).toContain('], env, engine.programDirectory);')
  expect(patched).toContain('], nativeEnvironment(profile, engine.programDirectory), engine.programDirectory);')
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

it.skipIf(installedKit() === undefined)('rewrites the installed kit the packaged runtime materializes', async () => {
  const kit = installedKit()
  if (kit === undefined) return
  const root = await mkdtemp(join(tmpdir(), 'office-engine-asar-installed-'))
  roots.push(root)
  const directory = join(root, 'libreoffice-kit')
  await cp(join(kit, 'lib'), join(directory, 'lib'), { recursive: true })
  patchOfficeEngineAsar(directory)
  const patched = await readFile(join(directory, 'lib', 'index.js'), 'utf8')
  expect(patched).toContain('const root = await physicalEngineRoot(dirname(packageFile));')
  expect(patched).toContain('function spawnNative(executable, args, env, cwd) {')
  expect(patched).toContain('], env, engine.programDirectory);')
  expect(patched).toContain('], nativeEnvironment(profile, engine.programDirectory), engine.programDirectory);')
})
