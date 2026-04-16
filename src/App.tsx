import { Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useLayout } from './contexts/LayoutContext';
import { LoginPage } from './pages/LoginPage';
import PropertiesPage from './pages/PropertiesPage';
import EnquiriesPage from './pages/EnquiriesPage';
import { EnquiryForm } from './pages/EnquiryForm';
import BookingCalendarPage from './pages/BookingCalendarPage';
import SettingsPage from './pages/SettingsPage';
import LoadingSpinner from './components/LoadingSpinner';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingSpinner fullScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const { signOut, user } = useAuth();
  const { pageTitle } = useLayout();

  return (
    <div className="app-layout">
      <header className="top-nav">
        <div className="top-nav-left">
          <NavLink to="/properties" className="top-nav-brand">CT Rentals</NavLink>
          <nav className="top-nav-links">
            <NavLink to="/properties" className={({ isActive }) => `top-nav-link ${isActive ? 'active' : ''}`}>
              Properties
            </NavLink>
            <NavLink to="/calendar" className={({ isActive }) => `top-nav-link ${isActive ? 'active' : ''}`}>
              Calendar
            </NavLink>
            <NavLink to="/enquiries" className={({ isActive }) => `top-nav-link ${isActive ? 'active' : ''}`}>
              Enquiries
            </NavLink>
            <NavLink to="/settings" className={({ isActive }) => `top-nav-link ${isActive ? 'active' : ''}`}>
              Settings
            </NavLink>
          </nav>
        </div>
        <div className="top-nav-right">
          <span className="top-nav-user">{user?.email}</span>
          <button className="btn btn-ghost" onClick={signOut}>Sign Out</button>
        </div>
      </header>

      <main className="main-content">
        <div className="page-header">
          <h1>{pageTitle}</h1>
        </div>
        <div className="page-content">
          {children}
        </div>
      </main>
    </div>
  );
}

export function App() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingSpinner fullScreen />;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/properties" replace /> : <LoginPage />} />
      <Route path="/properties" element={<ProtectedRoute><AppLayout><PropertiesPage /></AppLayout></ProtectedRoute>} />
      <Route path="/calendar" element={<ProtectedRoute><AppLayout><BookingCalendarPage /></AppLayout></ProtectedRoute>} />
      <Route path="/enquiries" element={<ProtectedRoute><AppLayout><EnquiriesPage /></AppLayout></ProtectedRoute>} />
      <Route path="/enquiry/new" element={<ProtectedRoute><AppLayout><EnquiryForm /></AppLayout></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><AppLayout><SettingsPage /></AppLayout></ProtectedRoute>} />
      <Route path="*" element={<Navigate to={user ? '/properties' : '/login'} replace />} />
    </Routes>
  );
}
