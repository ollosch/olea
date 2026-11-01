import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '')
  const api = `http://127.0.0.1:${env.E2E_API_PORT || '8090'}`
  return {
    plugins: [vue(), tailwindcss()],
    build: {
      outDir: 'server/ui/dist',
      emptyOutDir: true,
    },
    server: {
      proxy: {
        '/api': api,
        '/_/': api,
      },
    },
  }
})
