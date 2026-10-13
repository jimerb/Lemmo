import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works from any sub-path (e.g. GitHub Pages /lemmo/).
  base: './',
  server: { port: 4445, strictPort: true },
  preview: { port: 4445, strictPort: true },
});
