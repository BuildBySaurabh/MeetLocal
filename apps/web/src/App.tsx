import { BrowserRouter } from 'react-router-dom';
import { ErrorBoundary } from './components/layout/ErrorBoundary';
import { AppRoutes } from './routes/AppRoutes';

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </ErrorBoundary>
  );
}
