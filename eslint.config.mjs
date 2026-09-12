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
  {
    files: [
      'app/admin/**/check-in/page.tsx',
      'app/me/ParticipantSessionBoundary.tsx',
      'app/me/page.tsx',
      'components/layout/SiteHeaderEntry.tsx',
    ],
    rules: { '@next/next/no-html-link-for-pages': 'off' },
  },
  {
    files: ['app/me/ParticipantSessionBoundary.tsx'],
    rules: { 'react-hooks/set-state-in-effect': 'off' },
  },
  {
    files: [
      'components/domain/PosterWall.tsx',
      'components/home/HomeStatement.tsx',
      'components/home/HomeWall.tsx',
    ],
    rules: { '@next/next/no-img-element': 'off' },
  },
]

export default config
