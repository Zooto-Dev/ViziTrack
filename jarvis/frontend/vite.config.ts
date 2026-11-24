import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BACKEND = process.env.JARVIS_BACKEND ?? 'http://127.0.0.1:8765'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/ws': { target: BACKEND.replace('http', 'ws'), ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: { vendor: ['react', 'react-dom', 'zustand'] },
      },
    },
  },
})
