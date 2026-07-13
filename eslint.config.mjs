import next from 'eslint-config-next';

const eslintConfig = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'src/generated/**',
      'playwright-report/**',
      'test-results/**',
      '.agents/**',
      '.commandcode/**',
      'claude-obsidian/**',
      'e2e/**',
      'prisma/**',
      'scripts/**',
    ],
  },
  ...next,
];

export default eslintConfig;
