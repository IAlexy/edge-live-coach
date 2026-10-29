import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    {
      name: 'externalize-node-sqlite',
      resolveId(id) {
        if (id === 'node:sqlite' || id === 'sqlite') {
          return { id: 'node:sqlite', external: true };
        }
        return null;
      }
    }
  ],
  test: {
    globals: true,
    env: {
      DB_PATH: ':memory:'
    },
    include: ['tests/**/*.test.ts']
  }
});
