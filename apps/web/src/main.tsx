import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { FormValidationProvider } from './components/FormValidation';
import { router } from './router';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <FormValidationProvider>
      <RouterProvider router={router} />
    </FormValidationProvider>
  </React.StrictMode>
);
