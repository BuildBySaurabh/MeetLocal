import { Settings, Video } from 'lucide-react';
import { Link } from 'react-router-dom';

export function AppHeader() {
  return (
    <header className="app-header">
      <Link to="/" className="brand" aria-label="MeetLocal home">
        <span className="brand__mark" aria-hidden="true">
          <Video size={18} />
        </span>
        <span className="brand__name">MeetLocal</span>
      </Link>
      <nav aria-label="Primary">
        <Link to="/settings" className="btn btn--ghost btn--sm">
          <Settings size={16} aria-hidden="true" />
          <span>Settings</span>
        </Link>
      </nav>
    </header>
  );
}
