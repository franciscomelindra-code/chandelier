import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { server: 'src/server.ts', 'cli/create-admin': 'src/cli/create-admin.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Le paquet partagé est en TypeScript source : il est intégré au bundle.
  noExternal: ['@chandelier/shared'],
});
