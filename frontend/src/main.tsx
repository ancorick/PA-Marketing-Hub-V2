import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { MotionProvider } from './motion/MotionProvider';
import './styles/base.css';
import './styles/components.css';
import './styles/print.css';
import { installPrintTheme } from './lib/print';

installPrintTheme();

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false } },
});

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionProvider>
        <App />
      </MotionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
