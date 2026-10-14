import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'client/js/shared/', 'storage/', 'outbox/', '.vercel/'] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2024, sourceType: 'module' },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  { files: ['server/**', 'api/**', 'scripts/**', 'test/**', 'eslint.config.js'], languageOptions: { globals: globals.node } },
  { files: ['client/**'], languageOptions: { globals: globals.browser } },
  { files: ['shared/**'], languageOptions: { globals: {} } },
];
