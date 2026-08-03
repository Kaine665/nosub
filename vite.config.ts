import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './manifest.config';

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    target: 'chrome110',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    hmr: {
      port: 5173,
    },
  },
  test: {
    globals: true,
    environment: 'node',
    environmentMatchGlobs: [
      // 需要 DOM 的测试用 happy-dom(比 jsdom 轻、稳)
      ['tests/unit/youtube-player-adapter.test.ts', 'happy-dom'],
      ['tests/unit/navigation-observer.test.ts', 'happy-dom'],
      ['tests/unit/playback-engine.test.ts', 'happy-dom'],
      ['tests/unit/keyboard-controller.test.ts', 'happy-dom'],
      ['tests/unit/listening-ui.test.ts', 'happy-dom'],
      ['tests/unit/settings-repository.test.ts', 'happy-dom'],
    ],
    environmentOptions: {
      happyDOM: {
        // 让 happy-dom 的 origin = youtube.com,避免跨域 pushState 报错
        url: 'https://www.youtube.com/',
      },
    },
    include: ['tests/**/*.test.ts'],
  },
});
