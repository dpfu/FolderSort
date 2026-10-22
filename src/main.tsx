import React from 'react';
import ReactDOM from 'react-dom/client';
import './library.css';
import './design-system.css';
import LibraryApp from './LibraryApp';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><LibraryApp /></React.StrictMode>
);
