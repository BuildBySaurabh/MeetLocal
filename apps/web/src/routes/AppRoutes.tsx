import { Link, Route, Routes } from 'react-router-dom';
import { AppHeader } from '../components/layout/AppHeader';
import { HomePage } from './HomePage';
import { JoinMeetingPage } from './JoinMeetingPage';
import { MeetingPage } from './MeetingPage';
import { SettingsPage } from './SettingsPage';

function NotFoundPage() {
  return (
    <main className="page page--center">
      <div className="card card--narrow">
        <h1 className="card__title">Page not found</h1>
        <p className="muted">That address does not match anything in MeetLocal.</p>
        <Link to="/" className="btn btn--primary">
          Back to home
        </Link>
      </div>
    </main>
  );
}

export function AppRoutes() {
  return (
    <Routes>
      {/* The meeting page uses the full viewport and renders its own header. */}
      <Route path="/meeting/:roomId" element={<MeetingPage />} />
      <Route
        path="*"
        element={
          <div className="shell">
            <AppHeader />
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/join/:roomId" element={<JoinMeetingPage />} />
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes>
          </div>
        }
      />
    </Routes>
  );
}
