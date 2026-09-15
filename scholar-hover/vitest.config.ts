import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'jsdom', restoreMocks: true, include: ['tests/**/*.test.ts'] } });
