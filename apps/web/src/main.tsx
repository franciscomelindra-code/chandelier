import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import '@fontsource-variable/hanken-grotesk';
import './styles.css';
import { AuthProvider } from './lib/auth';
import { ApiError } from './lib/api';
import { router } from './app/router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

// Session expirée : retour à l'écran de connexion.
queryClient.getQueryCache().subscribe((event) => {
  const err = event.query.state.error;
  if (event.type === 'updated' && err instanceof ApiError && err.status === 401 && event.query.queryKey[0] !== 'me') {
    queryClient.setQueryData(['me'], null);
  }
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
