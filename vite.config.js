// Vite: `npm run dev` serves the game locally with instant reload; `npm run build` makes the
// optimised site in dist/ that gets hosted. Files in public/ (MediaPipe's model and WebAssembly)
// are copied as they are, because MediaPipe loads them itself at runtime.
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 8000 },
  preview: { port: 8000 },
  // three.js alone is ~600 kB (about 150 kB once compressed), which is normal for a 3D game
  build: { target: 'es2022', chunkSizeWarningLimit: 800 },
});
