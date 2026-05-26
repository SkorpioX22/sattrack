import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss()
  ],
  server: {
    proxy: {
      '/celestrak-api': {
        target: 'https://celestrak.org',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/celestrak-api/, '')
      }
    }
  },
  build: {
    target: 'esnext'
  },
  worker: {
    format: 'es'
  }
})
