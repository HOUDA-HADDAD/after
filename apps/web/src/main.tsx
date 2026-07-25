import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppRouter } from './app/router.js';
import './styles/index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root container missing — index.html must contain <div id="root">.');
}

createRoot(container).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
);
