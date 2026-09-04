const PASSWORD_SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8'
const RANGE_PATH = /^\/range\/([0-9A-F]{5})$/

const passwordRangeWorker = {
  fetch(request) {
    const url = new URL(request.url)
    const match = RANGE_PATH.exec(url.pathname)
    if (
      request.method !== 'GET' ||
      url.origin !== 'https://password-range.browser.invalid' ||
      url.search ||
      !match ||
      request.headers.get('accept') !== 'text/plain' ||
      request.headers.get('add-padding') !== 'true'
    ) {
      return new Response(null, { status: 400 })
    }

    const body =
      match[1] === '5BAA6'
        ? `${PASSWORD_SUFFIX}:3303003\r\n`
        : '00000000000000000000000000000000000:0\r\n'
    return new Response(body, {
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    })
  },
}

export default passwordRangeWorker
