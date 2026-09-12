const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i

export type Backend = 'webgpu' | 'webgl'

export async function hardwareBackend(): Promise<Backend | null> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu
  const adapter = (await gpu?.requestAdapter().catch(() => null)) as {
    info?: { architecture?: string; description?: string; isFallbackAdapter?: boolean }
  } | null
  if (adapter) {
    const { architecture = '', description = '', isFallbackAdapter = false } = adapter.info ?? {}
    if (!isFallbackAdapter && !SOFTWARE.test(`${architecture} ${description}`)) return 'webgpu'
  }
  const context = document.createElement('canvas').getContext('webgl2')
  if (!context) return null
  const debug = context.getExtension('WEBGL_debug_renderer_info')
  const renderer = String(
    context.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : context.RENDERER),
  )
  context.getExtension('WEBGL_lose_context')?.loseContext()
  return SOFTWARE.test(renderer) ? null : 'webgl'
}
