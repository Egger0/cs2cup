export function bindChapters(
  overlay: HTMLElement,
  select: (key: string | null, record: boolean) => void,
  progress: (value: number, keys: string[]) => void,
) {
  const root = document.documentElement
  let current = -1
  let frame = 0
  const read = () => {
    frame = 0
    const sections = [...document.body.querySelectorAll<HTMLElement>('[data-solar-chapter]')]
    if (!sections.length) return
    const middle = window.innerHeight / 2
    const boxes = sections.map(section => section.getBoundingClientRect())
    const centers = boxes.map(box => box.top + box.height / 2)
    centers.push(boxes.at(-1)!.bottom + window.innerHeight * 0.45)
    const keys = [...sections.map(section => section.dataset.solarChapter ?? ''), 'far']
    let value = 0
    for (let index = 0; index < centers.length - 1; index++)
      if (centers[index]! <= middle)
        value =
          index +
          Math.min(
            1,
            (middle - centers[index]!) / Math.max(1, centers[index + 1]! - centers[index]!),
          )
    const fade = Math.min(1, value).toFixed(3)
    if (sections[0]!.style.getPropertyValue('--solar-progress') !== fade)
      sections[0]!.style.setProperty('--solar-progress', fade)
    const exit = Math.min(1, Math.max(0, value - (keys.length - 2))).toFixed(3)
    if (root.style.getPropertyValue('--solar-exit') !== exit)
      root.style.setProperty('--solar-exit', exit)
    progress(value, keys)
    if (current >= 0 && Math.abs(value - current) < 0.58) return
    if (performance.now() - Number(overlay.dataset.focusAt ?? -Infinity) < 250) return
    const next = Math.round(value)
    if (next === current) return
    const initial = current < 0
    current = next
    const key = keys[next]!
    root.dataset.solarChapter = key === 'far' ? 'far' : 'near'
    if (initial && key === 'overview') return
    select(key === 'overview' || key === 'far' ? null : key, false)
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(read)
  }
  read()
  window.addEventListener('scroll', schedule, { passive: true })
  window.addEventListener('resize', schedule)
  return () => {
    window.removeEventListener('scroll', schedule)
    window.removeEventListener('resize', schedule)
    cancelAnimationFrame(frame)
    delete root.dataset.solarChapter
    root.style.removeProperty('--solar-exit')
  }
}
