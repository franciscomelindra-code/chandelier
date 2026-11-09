import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  test: {
    // Une seule base de test partagée par l'API : fichiers exécutés séquentiellement.
    fileParallelism: false,
    projects: [
      {
        test: {
          name: 'shared',
          include: ['packages/shared/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'api',
          include: ['apps/api/test/**/*.test.ts', 'apps/api/src/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['apps/api/test/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 120_000,
        },
      },
      {
        plugins: [react()],
        test: {
          name: 'web',
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['apps/web/src/test-setup.ts'],
        },
      },
    ],
  },
});
