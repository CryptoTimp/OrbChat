import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Note: StrictMode disabled to prevent double socket connections in development
ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />
)
