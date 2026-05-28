import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { Toaster } from './components/Toaster.tsx'
import { toast } from './lib/toast'
import './index.css'

window.alert = (msg: any) => toast.error(String(msg));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Toaster />
  </React.StrictMode>,
)
