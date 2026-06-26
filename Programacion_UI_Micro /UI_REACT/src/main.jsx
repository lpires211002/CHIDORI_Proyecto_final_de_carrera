import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// StrictMode removido: double-invocation de effects rompe WebSocket lifecycle
// (mount→cleanup→mount cierra el socket antes de que el segundo mount conecte)
createRoot(document.getElementById('root')).render(
  <App />
)
