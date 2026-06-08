import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'node_modules/**',
      'vendor/**',
      'idl/**',
      'public/**',
      'scripts/**',
      'tests/**',
      'db/**',
      'gitbook/**',
      'mobile-android/**',
      'heres_program/**',
      'cre-workflow/**',
      'heres-cre/**',
      'next-env.d.ts',
    ],
  },
  ...nextCoreWebVitals,
  {
    rules: {
      'react/no-unescaped-entities': 'off',
      // eslint-plugin-react-hooks@7 (pulled in by eslint-config-next@16) adds new
      // react-compiler-era rules that did not exist under Next 14. Keep them as
      // warnings for now so the upgrade does not block on a pre-existing-code
      // refactor; promote back to errors in a dedicated cleanup pass.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',
      'react-hooks/refs': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
]

export default eslintConfig
