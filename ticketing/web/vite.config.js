import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 18081,
    proxy: {
      '/api/auth': 'http://localhost:5180',
      '/api': 'http://localhost:5182',
    },
  },
})
