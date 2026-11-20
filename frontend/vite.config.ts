import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ command, mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  // Fail the Netlify build early instead of shipping a page that cannot reach the API.
  if (command === 'build' && !env.VITE_API_URL?.trim()) {
    throw new Error('VITE_API_URL must be set for production builds (see frontend/.env.example).');
  }
  return {
    plugins: [react()],
    server: { port: 5173, strictPort: true },
    build: { outDir: 'dist', sourcemap: true },
  };
});
