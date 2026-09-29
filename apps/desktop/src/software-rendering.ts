/** Chromium rendering strategy for desktop hosts whose GPU process cannot start. */

/** Chromium switches that keep rendering on the CPU. */
const SOFTWARE_RENDERING_SWITCHES = ['disable-gpu', 'disable-gpu-compositing', 'in-process-gpu']

/**
 * Whether the deployment selected software rendering.
 *
 * `DSH_DESKTOP_SOFTWARE_RENDERING=1` supports virtual machines and remote-desktop sessions, where
 * Chromium's GPU process fails and leaves windows blank.
 * @param env - Process environment of the desktop shell.
 * @returns True when software rendering was selected.
 */
export function softwareRenderingRequested(env: NodeJS.ProcessEnv): boolean {
  const requested = env.DSH_DESKTOP_SOFTWARE_RENDERING
  if (requested === undefined) return false
  if (requested !== '0' && requested !== '1') {
    throw new Error(`desktop shell: DSH_DESKTOP_SOFTWARE_RENDERING must be 0 or 1, received ${requested}`)
  }
  return requested === '1'
}

/** The Electron surfaces that select the rendering strategy. */
type RenderingApplication = {
  /** Disables hardware acceleration for this process. */
  disableHardwareAcceleration: () => void
  /** Electron command line that carries Chromium switches. */
  commandLine: { appendSwitch: (name: string) => void }
}

/**
 * Apply the rendering strategy before Electron becomes ready. Applying it later has no effect on the
 * GPU process, which Chromium starts while it initializes.
 * @param app - Electron application that owns acceleration and the command line.
 * @param env - Process environment of the desktop shell.
 */
export function applySoftwareRendering(app: RenderingApplication, env: NodeJS.ProcessEnv): void {
  if (!softwareRenderingRequested(env)) return
  app.disableHardwareAcceleration()
  for (const name of SOFTWARE_RENDERING_SWITCHES) app.commandLine.appendSwitch(name)
}
