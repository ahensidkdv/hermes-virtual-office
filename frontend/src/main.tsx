import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'

function App() {
  return (
    <div className="container">
      <h1>Hermes Virtual Office</h1>
      <p>Frontend initialization in progress...</p>
      <p>Phase 1 starts Oct 15, 2026</p>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
