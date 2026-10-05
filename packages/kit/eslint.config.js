import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // Vendored from the shadcn registry. We do not hand-edit these files, so
    // holding them to our own fast-refresh rule only produces noise we cannot
    // act on without diverging from upstream.
    files: ['src/components/**'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // The shadcn carousel and the reui data grid, as their registries ship
    // them. These are the rules they break, and only these: fixing them by
    // hand would make the next registry update a merge instead of a copy.
    // Our own components under src/components stay on the full rule set.
    files: ['src/components/carousel.tsx', 'src/components/reui/**'],
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      'no-useless-assignment': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/use-memo': 'off',
    },
  },
])
