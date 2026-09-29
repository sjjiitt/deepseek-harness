/** One validated brand asset: its whitelist path and the bytes to write there. */
export interface BrandEntry {
  /** Whitelist path relative to the app root, slash-separated. */
  readonly path: string
  /** File content to materialize. */
  readonly data: Buffer
}

/**
 * Read the brand archive the environment names, if any.
 * @param env - Packaging environment.
 * @returns Validated entries, or undefined when neither archive variable is set.
 */
export function resolveBrandInjection(env?: NodeJS.ProcessEnv): Promise<BrandEntry[] | undefined>

/**
 * Copy the validated entries over the repository source paths.
 * @param entries - Validated brand assets.
 * @param appRoot - Desktop application directory the whitelist paths resolve against.
 * @returns Restore function putting the upstream tree back; idempotent.
 */
export function materializeBrandInjection(entries: readonly BrandEntry[], appRoot: string): () => void

/**
 * The brand resource files a packaged application should carry beside
 * `icon.png`, filtered to the ones present in the repository resources.
 * @param resourcesDir - The desktop app's `resources/` source directory.
 * @returns Present brand file names.
 */
export function presentBrandResourceFiles(resourcesDir: string): string[]

/** Source paths a brand archive may replace, relative to the app root. */
export const BRAND_ASSET_PATHS: readonly string[]
