import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      canvg: path.resolve('src/dummy.js'),
      html2canvas: path.resolve('src/dummy.js'),
      dompurify: path.resolve('src/dummy.js')
    }
  }
})
