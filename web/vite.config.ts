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
    // The largest chunks are Shiki language grammars (cpp ~700kB, emacs-lisp
    // ~800kB), Shiki's WASM regex engine (~620kB), and Mermaid's cytoscape
    // dep (~440kB) — all lazy-loaded only when a document needs them, so
    // they never affect cold-start.  Raise the warning ceiling above those
    // so it stays useful as a regression signal for the eager bundle.
    chunkSizeWarningLimit: 900,
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