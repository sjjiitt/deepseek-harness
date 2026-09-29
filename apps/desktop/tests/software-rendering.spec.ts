import { describe, expect, it, vi } from 'vitest'
import { applySoftwareRendering, softwareRenderingRequested } from '../src/software-rendering.ts'

function fakeApplication() {
  const switches: string[] = []
  return {
    switches,
    disableHardwareAcceleration: vi.fn(),
    commandLine: { appendSwitch: (name: string) => { switches.push(name) } },
  }
}

describe('desktop rendering strategy', () => {
  it('keeps the accelerated path unless the deployment selects software rendering', () => {
    expect(softwareRenderingRequested({})).toBe(false)
    expect(softwareRenderingRequested({ DSH_DESKTOP_SOFTWARE_RENDERING: '0' })).toBe(false)
    const application = fakeApplication()
    applySoftwareRendering(application, {})
    expect(application.disableHardwareAcceleration).not.toHaveBeenCalled()
    expect(application.switches).toEqual([])
  })

  it('disables hardware acceleration and every GPU switch when selected', () => {
    const application = fakeApplication()
    applySoftwareRendering(application, { DSH_DESKTOP_SOFTWARE_RENDERING: '1' })
    expect(application.disableHardwareAcceleration).toHaveBeenCalledTimes(1)
    expect(application.switches).toEqual(['disable-gpu', 'disable-gpu-compositing', 'in-process-gpu'])
  })

  it('rejects a selection that is neither 0 nor 1', () => {
    expect(() => softwareRenderingRequested({ DSH_DESKTOP_SOFTWARE_RENDERING: 'true' }))
      .toThrow('DSH_DESKTOP_SOFTWARE_RENDERING must be 0 or 1')
    expect(() => { applySoftwareRendering(fakeApplication(), { DSH_DESKTOP_SOFTWARE_RENDERING: 'yes' }) })
      .toThrow('DSH_DESKTOP_SOFTWARE_RENDERING must be 0 or 1')
  })
})
