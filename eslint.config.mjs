import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

const config = [
  { ignores: ['.next/**', '.open-next/**', '.wrangler/**', 'node_modules/**', 'dist/**', 'migration-output/**', 'public/**'] },
  ...coreWebVitals,
  ...typescript,
]

export default config
