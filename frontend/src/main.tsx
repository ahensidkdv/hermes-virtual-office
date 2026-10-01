import React from 'react'
import ReactDOM from 'react-dom/client'
import { OfficePage } from './pages/Office'
import './index.css'

function App() {
  return <OfficePage />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
