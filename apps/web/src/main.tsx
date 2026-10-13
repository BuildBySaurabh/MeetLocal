import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { registerServiceWorker } from './services/registerServiceWorker';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root was not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

registerServiceWorker();
