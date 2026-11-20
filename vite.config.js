import react from '@vitejs/plugin-react'
import ViteReactMCP from 'vite-react-mcp'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

const apiProxy = {
  '/api': {
    // Use the IPv4 loopback explicitly: the backend binds 0.0.0.0, and on
    // Windows `localhost` can resolve to ::1 first, which produces a 502.
    target: 'http://127.0.0.1:4000',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/api/, ''),
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [tailwindcss(), react(), ViteReactMCP()],
  server: {
    proxy: apiProxy,
  },
  // `vite preview` does not inherit server.proxy; configure it separately so
  // `npm run preview` can reach the API too.
  preview: {
    proxy: apiProxy,
  },
})
