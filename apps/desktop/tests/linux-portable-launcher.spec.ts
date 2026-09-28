import { describe, expect, it } from 'vitest'
import { portableLauncher } from '../scripts/package-linux-arm64-portable.ts'

describe('Linux arm64 portable launcher', () => {
  it('replaces the desktop GTK module list instead of naming the canberra module', () => {
    const launcher = portableLauncher()
    expect(launcher).toContain('GTK_MODULES="${DSH_DESKTOP_GTK_MODULES:-gail:atk-bridge}"')
    expect(launcher).toContain('export GTK_MODULES')
    expect(launcher).not.toMatch(/GTK_MODULES="[^"]*canberra/u)
  })

  it('keeps the accessibility bridge and lets a deployment name its own module list', () => {
    const launcher = portableLauncher()
    expect(launcher).toContain('gail:atk-bridge')
    expect(launcher).toContain('DSH_DESKTOP_GTK_MODULES')
  })

  it('starts the packaged application with the flags that keep the renderer responsive', () => {
    const launcher = portableLauncher()
    expect(launcher).toContain('--disable-background-timer-throttling')
    expect(launcher).toContain('--disable-renderer-backgrounding')
    expect(launcher).toContain('--disable-backgrounding-occluded-windows')
    expect(launcher).toContain('--class=deepseek-harness')
    expect(launcher).toContain('exec "$here/deepseek-harness" $flags "$@"')
  })

  it('passes the sandbox switch only when the deployment asks for it', () => {
    const launcher = portableLauncher()
    expect(launcher).toContain('if [ "${DSH_DESKTOP_NO_SANDBOX:-0}" = 1 ]; then')
    expect(launcher).toContain('flags="$flags --no-sandbox"')
  })
})
