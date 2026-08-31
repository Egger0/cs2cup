import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

const config = [
  {
    ignores: [
      '.next/**',
      '.open-next/**',
      '.local/**',
      '.wrangler/**',
      'node_modules/**',
      'dist/**',
      'migration-output/**',
      'public/**',
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    rules: {
      'id-match': [
        'error',
        '^[A-Za-z_$][A-Za-z0-9_$]*$',
        { properties: false, onlyDeclarations: true },
      ],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
]

export default config
