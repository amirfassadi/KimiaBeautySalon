import { defineConfig } from 'vite';
import { kimiaPreview } from './scripts/vite-preview.mjs';

export default defineConfig({
  plugins: [kimiaPreview()],
  server: { host: '0.0.0.0', port: 3000 },
});
