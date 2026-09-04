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
    // This package is a library, not a Vite app: nothing in it is a fast
    // refresh boundary. Its modules pair a provider or a component with the
    // hook that reads it - RegistryProvider with useRegistry,
    // ForgeDashboardProvider with useDashboardConfig - which is the point of
    // the module, not an accident worth splitting up.
    files: ['src/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Intent modules deliberately co-export a set of intent components and the
    // registry builder that wires them up. Every contributor module in this
    // architecture has that shape, so the one-kind-of-export rule fast refresh
    // wants is not a rule this repo can hold.
    files: ['**/intents.tsx', '**/intents/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
