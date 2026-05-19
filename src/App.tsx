import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useLayout } from './contexts/LayoutContext';
import { LoginPage } from './pages/LoginPage';
import PropertiesPage from './pages/PropertiesPage';
import { EnquiryForm } from './pages/EnquiryForm';
import BookingCalendarPage from './pages/BookingCalendarPage';
import SettingsPage from './pages/SettingsPage';
import LoadingSpinner from './components/LoadingSpinner';
import Fab from './components/Fab';
import Sidebar from './components/Sidebar';
import SectionPlaceholder from './pages/SectionPlaceholder';
import PipelinePage from './pages/PipelinePage';
import AgentsPage from './pages/AgentsPage';
import GuestsPage from './pages/GuestsPage';
import HomeOwnersPage from './pages/HomeOwnersPage';
import SeasonTagsPage from './pages/SeasonTagsPage';
import ChannelDefaultsPage from './pages/ChannelDefaultsPage';
import FinancePricingPage from './pages/FinancePricingPage';
import HomePage from './pages/HomePage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingSpinner fullScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const { pageTitle, pageHeaderSlot, pageHeaderHidden } = useLayout();

  return (
    <div className="app-layout">
      <Sidebar />
      <main className="main-content">
        {!pageHeaderHidden && (
          <div className={`page-header ${pageHeaderSlot ? 'page-header--slot' : ''}`}>
            {pageHeaderSlot ? pageHeaderSlot : <h1>{pageTitle}</h1>}
          </div>
        )}
        <div className="page-content">
          {children}
        </div>
      </main>
      <Fab />
    </div>
  );
}

// Convenience wrapper to keep the route table readable.
function Page({ children }: { children: React.ReactNode }) {
  return <ProtectedRoute><AppLayout>{children}</AppLayout></ProtectedRoute>;
}

export function App() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingSpinner fullScreen />;

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />

      {/* Home */}
      <Route path="/dashboard" element={<Page><HomePage /></Page>} />

      {/* Properties + Brochures */}
      <Route path="/properties" element={<Page><PropertiesPage /></Page>} />
      {/* Brochures lived as a sibling of Properties. Removed from the
          nav because it duplicated the property card's Copy / Preview
          actions; redirect the URL so old bookmarks still land somewhere
          sensible. */}
      <Route path="/brochures" element={<Navigate to="/properties" replace />} />

      {/* Operations — Pipeline unifies the old Enquiries + Proposals pages
          into a single deal-flow view. Old URLs redirect so existing
          bookmarks / external links don't 404. */}
      <Route path="/operations" element={<Navigate to="/operations/pipeline" replace />} />
      <Route path="/operations/pipeline" element={<Page><PipelinePage /></Page>} />
      <Route path="/operations/enquiries" element={<Navigate to="/operations/pipeline" replace />} />
      <Route path="/operations/proposals" element={<Navigate to="/operations/pipeline" replace />} />
      <Route path="/operations/bookings" element={<Page><BookingCalendarPage /></Page>} />

      {/* CRM */}
      <Route path="/crm" element={<Navigate to="/crm/guests" replace />} />
      <Route path="/crm/guests" element={<Page><GuestsPage /></Page>} />
      <Route path="/crm/home-owners" element={<Page><HomeOwnersPage /></Page>} />
      <Route path="/crm/agents" element={<Navigate to="/settings/agents" replace />} />

      {/* Finance */}
      <Route path="/finance" element={<Navigate to="/finance/pricing" replace />} />
      <Route path="/finance/pricing" element={<Page><FinancePricingPage /></Page>} />
      <Route path="/finance/contracts" element={<Page><SectionPlaceholder pageTitle="Contracts" title="Contracts coming soon" description="Owner agreements and guest contracts tracked alongside the property record." icon="📄" /></Page>} />
      <Route path="/finance/invoices" element={<Page><SectionPlaceholder pageTitle="Invoices" title="Invoices coming soon" description="Issue, track and reconcile invoices against bookings and owner payouts." icon="🧾" /></Page>} />

      {/* Reports */}
      <Route path="/reports" element={<Navigate to="/reports/sales" replace />} />
      <Route path="/reports/sales" element={<Page><SectionPlaceholder pageTitle="Sales" title="Sales reports coming soon" description="Conversion funnels from enquiry to booking, broken out by source and agent." icon="📈" /></Page>} />
      <Route path="/reports/business-profit" element={<Page><SectionPlaceholder pageTitle="Business Profit" title="Profit reports coming soon" description="Month-over-month revenue, commissions and net margin across the portfolio." icon="📊" /></Page>} />
      <Route path="/reports/properties" element={<Page><SectionPlaceholder pageTitle="Properties Report" title="Property reports coming soon" description="Per-property occupancy, revenue and lead-source performance." icon="🏘" /></Page>} />

      {/* Settings */}
      <Route path="/settings" element={<Navigate to="/settings/seasons" replace />} />
      <Route path="/settings/seasons" element={<Page><SettingsPage tab="seasons"><SeasonTagsPage embedded /></SettingsPage></Page>} />
      <Route path="/settings/platforms" element={<Page><SettingsPage tab="platforms"><ChannelDefaultsPage embedded /></SettingsPage></Page>} />
      <Route path="/settings/channels" element={<Navigate to="/settings/platforms" replace />} />
      <Route path="/settings/agents" element={<Page><SettingsPage tab="agents"><AgentsPage embedded /></SettingsPage></Page>} />

      {/* Standalone form */}
      <Route path="/enquiry/new" element={<Page><EnquiryForm /></Page>} />

      {/* Legacy URL redirects */}
      <Route path="/enquiries" element={<Navigate to="/operations/enquiries" replace />} />
      <Route path="/calendar" element={<Navigate to="/operations/bookings" replace />} />

      <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
    </Routes>
  );
}
