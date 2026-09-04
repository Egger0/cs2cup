import 'server-only'

type HeaderReader = Pick<Headers, 'get'>

function browserName(userAgent: string) {
  if (/Edg(?:A|iOS)?\//.test(userAgent)) return 'Edge'
  if (/OPR\/|Opera\//.test(userAgent)) return 'Opera'
  if (/SamsungBrowser\//.test(userAgent)) return 'Samsung Internet'
  if (/CriOS\/|Chrome\//.test(userAgent)) return 'Chrome'
  if (/FxiOS\/|Firefox\//.test(userAgent)) return 'Firefox'
  if (/Version\/[^ ]+.*Safari\//.test(userAgent)) return 'Safari'
  return '未知浏览器'
}

function systemName(userAgent: string) {
  if (/iPad|Macintosh.*Mobile\//.test(userAgent)) return 'iPadOS'
  if (/iPhone|iPod/.test(userAgent)) return 'iOS'
  if (/Android/.test(userAgent)) return 'Android'
  if (/Windows/.test(userAgent)) return 'Windows'
  if (/CrOS/.test(userAgent)) return 'ChromeOS'
  if (/Mac OS X/.test(userAgent)) return 'macOS'
  if (/Linux/.test(userAgent)) return 'Linux'
  return '未知系统'
}

export function clientSessionLabel(headers: HeaderReader) {
  const userAgent = headers.get('user-agent') ?? ''
  return `${browserName(userAgent)} · ${systemName(userAgent)}`
}
