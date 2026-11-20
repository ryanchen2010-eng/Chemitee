import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode === 'production' ? 'production' : 'development'),
    global: 'globalThis',
    __CAPSTONE_PRIVATE_BETA__: JSON.stringify(process.env.CAPSTONE_PRIVATE_BETA_BUILD === '1'),
    __HOSTED_WORKSPACE__: JSON.stringify(process.env.CAPSTONE_HOSTED_WORKSPACE_PREVIEW === '1' || process.env.CAPSTONE_HOSTED_WORKSPACE_BUILD === '1'),
  },
  resolve: {
    alias: {
      events: resolve(__dirname, 'node_modules/events/events.js'),
    },
  },
  server: {
    proxy: {
      '/api/account': process.env.CAPSTONE_ACCOUNT_PROXY_DISABLED === '1' ? 'http://127.0.0.1:1'
        : process.env.CAPSTONE_HOSTED_WORKSPACE_PREVIEW === '1' ? 'http://127.0.0.1:8002' : 'http://127.0.0.1:8001',
      '/api': 'http://127.0.0.1:8000',
    },
  },
  build: {
    // Ketcher includes mixed ESM/CommonJS files (notably Raphael loading).
    // Convert their require() calls too; they cannot run natively in browsers.
    commonjsOptions: { transformMixedEsModules: true },
    rollupOptions: {
      input: {
        home: resolve(__dirname, 'index.html'),
        explorer: resolve(__dirname, 'explore.html'),
        builder: resolve(__dirname, 'builder.html'),
        reactionLab: resolve(__dirname, 'reaction-lab.html'),
        calculators: resolve(__dirname, 'calculators.html'),
      },
    },
  },
}));
