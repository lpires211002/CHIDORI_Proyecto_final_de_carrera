import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  // ── GUARDIA DE BUILD ────────────────────────────────────────────────
  // Al GENERAR el ejecutable (command === 'build'), si faltan las variables
  // de Supabase la app saldría sin conexión a la nube. Cortamos con un
  // mensaje claro para NO distribuir un binario roto (el equivalente al
  // ".env no se descargó" que pasa al pullear el repo).
  if (command === 'build' && (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY)) {
    throw new Error(
      '\n\n[Chidori] Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY.\n' +
      '  Esta maquina de build necesita el archivo UI_REACT/.env.local con\n' +
      '  esas dos variables ANTES de generar el ejecutable.\n' +
      '  Copia .env.example a .env.local y completa los valores.\n'
    )
  }

  return {
    // Base relativa: los assets se referencian como ./assets/... para que
    // carguen bajo file:// dentro del ejecutable de Electron.
    base: './',
    plugins: [react()],
    resolve: {
      alias: {
        canvg: path.resolve('src/dummy.js'),
        html2canvas: path.resolve('src/dummy.js'),
        dompurify: path.resolve('src/dummy.js')
      }
    }
  }
})
