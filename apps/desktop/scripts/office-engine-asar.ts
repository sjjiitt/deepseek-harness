/** Point the installed LibreOffice kit at the physical engine copy beside an ASAR archive. */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Resolver line the published kit ships. */
const UNPATCHED_ROOT_LINE = '\tconst root = dirname(packageFile);'

/** Resolver line that prefers the physical engine directory. */
const PATCHED_ROOT_LINE = '\tconst root = await physicalEngineRoot(dirname(packageFile));'

/** Resolver declaration the engine-root helper is inserted before. */
const READ_ENGINE_DECLARATION = 'async function readEngine(packageFile, backend, target) {'

/** Conversion entry declaration the diagnostic helper is inserted before. */
const RUN_NATIVE_DECLARATION = 'async function runNative(engine, options, input, output, profile, fonts, substitutions, signal, operation = {'

/** Helper call options as the published kit passes them, without a working directory. */
const SPAWN_OPTIONS = '\t], {\n\t\tstdio: [\n\t\t\t"ignore",\n\t\t\t"pipe",\n\t\t\t"pipe"\n\t\t],\n\t\twindowsHide: true,\n\t\tenv\n\t});'

/** Helper call options pinned to the engine's own program directory. */
const SPAWN_OPTIONS_WITH_CWD = '\t], {\n\t\tstdio: [\n\t\t\t"ignore",\n\t\t\t"pipe",\n\t\t\t"pipe"\n\t\t],\n\t\twindowsHide: true,\n\t\tcwd: engine.programDirectory,\n\t\tenv\n\t});'

/** Failure message value that drops the helper's own diagnostics. */
const MESSAGE_VALUE = '${result.error ?? stderr}'

/** Failure message value that keeps a bounded tail of the helper's diagnostics. */
const MESSAGE_VALUE_WITH_DIAGNOSTIC = '${result.error ?? stderr}${nativeDiagnostic(stderr)}'

/** Engine-root helper: keep the sibling directory of an archived engine path. */
const PHYSICAL_ROOT_HELPER = `async function physicalEngineRoot(resolved) {
	const unpacked = resolved.replace(/([\\\\/])app\\.asar([\\\\/])/u, "$1app.asar.unpacked$2");
	if (unpacked === resolved) return resolved;
	try {
		const status = await stat(unpacked);
		return status.isDirectory() ? unpacked : resolved;
	} catch {
		return resolved;
	}
}
`

/** Diagnostic helper: append the helper's own output to a conversion failure. */
const NATIVE_DIAGNOSTIC_HELPER = `function nativeDiagnostic(stderr) {
	const text = stderr.trim();
	return text === "" ? "" : " [stderr: " + text.slice(-2000) + "]";
}
`

/** One reviewed replacement; the source must contain it exactly once. */
interface Replacement {
  readonly from: string
  readonly to: string
}

const REPLACEMENTS: readonly Replacement[] = [
  { from: READ_ENGINE_DECLARATION, to: `${PHYSICAL_ROOT_HELPER}${READ_ENGINE_DECLARATION}` },
  { from: UNPATCHED_ROOT_LINE, to: PATCHED_ROOT_LINE },
  { from: RUN_NATIVE_DECLARATION, to: `${NATIVE_DIAGNOSTIC_HELPER}${RUN_NATIVE_DECLARATION}` },
  { from: SPAWN_OPTIONS, to: SPAWN_OPTIONS_WITH_CWD },
  { from: MESSAGE_VALUE, to: MESSAGE_VALUE_WITH_DIAGNOSTIC },
]

/**
 * Rewrite the materialized kit so a native helper runs from a readable engine directory.
 * The kit resolves its engine with `require.resolve`; inside `app.asar` that can name an
 * archived directory, and the spawned helper would run with the parent's working directory.
 * The rewrite prefers the physical `app.asar.unpacked` sibling, pins the helper's working
 * directory to the engine's program directory, and keeps the helper's own diagnostics.
 * @param moduleDirectory - Installed `@deepseek-ai/libreoffice-kit` directory.
 * @returns Nothing.
 * @throws {Error} When the installed kit no longer matches the reviewed source.
 */
export function patchOfficeEngineAsar(moduleDirectory: string): void {
  const file = join(moduleDirectory, 'lib', 'index.js')
  const source = readFileSync(file, 'utf8')
  if (source.includes('physicalEngineRoot')) return
  let patched = source
  for (const replacement of REPLACEMENTS) {
    if (!patched.includes(replacement.from)) {
      throw new Error(`desktop runtime: ${file} no longer matches the reviewed LibreOffice kit source (missing ${JSON.stringify(replacement.from.slice(0, 48))})`)
    }
    // The reviewed anchors cover both the conversion and the rendering failure paths.
    patched = patched.replaceAll(replacement.from, replacement.to)
  }
  writeFileSync(file, patched)
}
