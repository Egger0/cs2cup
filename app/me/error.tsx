'use client'

export default function MeError({ error }: { error: Error & { digest?: string } }) {
  return (
    <div style={{ padding: '32px', fontFamily: 'monospace', fontSize: '13px' }}>
      <h1 style={{ fontSize: '20px', marginBottom: '16px' }}>/me render error</h1>
      <pre style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {`name: ${error.name}\nmessage: ${error.message}\ndigest: ${error.digest ?? '(none)'}\nstack:\n${error.stack ?? '(none)'}`}
      </pre>
    </div>
  )
}
