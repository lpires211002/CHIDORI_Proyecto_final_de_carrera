import { createRoot } from 'react-dom/client'

// Fuentes empaquetadas en el bundle · NO por CDN: la app funciona sin internet
// (conectada al Access Point del equipo), donde Google Fonts no cargaría.
import '@fontsource/montserrat/400.css'
import '@fontsource/montserrat/500.css'
import '@fontsource/montserrat/600.css'
import '@fontsource/montserrat/700.css'
import '@fontsource/climate-crisis'          // solo para la marca "Chidori"

import './index.css'
import App from './App.jsx'

// StrictMode removido: double-invocation de effects rompe WebSocket lifecycle
// (mount→cleanup→mount cierra el socket antes de que el segundo mount conecte)
createRoot(document.getElementById('root')).render(
  <App />
)
