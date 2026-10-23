import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: { alias: { $lib: path.resolve('./src/lib') } },
  // Tauri expects a fixed port and must not have the screen cleared under its own logs.
  clearScreen: false,
  server: { port: 5173, strictPort: true },
})
