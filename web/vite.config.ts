import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root: here,
  publicDir: resolve(here, 'public'),
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    target: 'es2022',
    cssMinify: true,
    minify: 'esbuild',
    assetsInlineLimit: 4096,
    rollupOptions: {
      output: {
        // Keep chunk names stable so lazy imports are cacheable.
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  worker: {
    format: 'es',
  },
  server: {
    port: 8080,
    host: '0.0.0.0',
    strictPort: true,
  },
  preview: {
    port: 8080,
    host: '0.0.0.0',
    strictPort: true,
    allowedHosts: true,
  },
});