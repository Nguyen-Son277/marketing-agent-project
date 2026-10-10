import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@marketing-agent/shared': r('./packages/shared/src/index.ts'),
      '@marketing-agent/db': r('./packages/db/src/index.ts'),
      '@marketing-agent/llm': r('./packages/llm/src/index.ts'),
      '@marketing-agent/agent-runtime': r('./packages/agent-runtime/src/index.ts'),
      '@marketing-agent/kb': r('./packages/kb/src/index.ts'),
      '@marketing-agent/tools': r('./packages/tools/src/index.ts'),
      '@marketing-agent/orchestrator': r('./packages/orchestrator/src/index.ts'),
      // Import the seed package only through its root: a plain string alias for
      // the root would shadow any subpath, so subpaths are re-exported instead.
      '@marketing-agent/seed': r('./seed/src/index.ts'),
    },
  },
  test: {
    include: ['packages/*/tests/**/*.test.ts', 'apps/*/tests/**/*.test.ts', 'seed/tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
})
