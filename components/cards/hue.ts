export function hueOf(text: string) {
  let hash = 0
  for (const char of text) hash = (hash * 31 + char.codePointAt(0)!) % 360
  return hash
}
