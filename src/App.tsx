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
import ProposalsPage from './pages/ProposalsPage';
import AgentsPage from './pages/AgentsPage';
import GuestsPage from './pages/GuestsPage';
import HomeOwnersPage from './pages/HomeOwnersPage';
import SeasonTagsPage from './pages/SeasonTagsPage';
import ChannelDefaultsPage from './pages/ChannelDefaultsPage';
import FinancePricingPage from './pages/FinancePricingPage';
import HomePage from './pages/HomePage';
import AcceptInvitePage from './pages/AcceptInvitePage';

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

/** Hostnames where the admin portal is allowed to render. Anything else
 *  (the public-facing southernescapes.co.za / ctvilla.co.za apex + www)
 *  gets the holding page below. Public-facing static assets like
 *  /brochure.html and /proposal.html sit outside React and continue to
 *  serve everywhere — only the React app's portal routes are gated.
 *
 *  Adding a host here is the only step needed to "let new people in"
 *  (e.g. when a future admin.xyz domain comes online). */
const ADMIN_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  'admin.southernescapes.co.za',
  'ctrentals.vercel.app', // the project preview / fallback URL
]);

function isAdminHost(): boolean {
  if (typeof window === 'undefined') return true;
  const h = window.location.hostname.toLowerCase();
  if (ADMIN_HOSTS.has(h)) return true;
  // Allow any vercel.app subdomain (preview deploys).
  if (h.endsWith('.vercel.app')) return true;
  return false;
}

/** Holding page shown on the public domain until the marketing site is
 *  built. No portal links — there's nothing here to find for someone
 *  who lands on southernescapes.co.za. */
function ComingSoon() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      textAlign: 'center',
      fontFamily: 'system-ui, sans-serif',
      background: '#FAFAF7',
      color: '#1A1A1A',
    }}>
      <div style={{ fontSize: '12px', letterSpacing: '4px', textTransform: 'uppercase', color: '#C5A572', marginBottom: '16px' }}>
        Southern Escapes
      </div>
      <h1 style={{ fontSize: 'clamp(28px, 5vw, 48px)', margin: '0 0 12px', fontWeight: 500 }}>
        Coming soon
      </h1>
      <p style={{ fontSize: '15px', color: '#555', maxWidth: '420px', margin: '0 0 24px', lineHeight: 1.5 }}>
        Our new home is being built. For enquiries and reservations, please get in touch.
      </p>
      <a
        href="mailto:hayley@capetrentals.com"
        style={{ color: '#1E40AF', textDecoration: 'none', fontSize: '14px', fontWeight: 500 }}
      >
        hayley@capetrentals.com
      </a>
    </div>
  );
}

export function App() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingSpinner fullScreen />;

  // Gate the entire portal to the admin host(s). Static public pages
  // (brochure.html, proposal.html) live outside React and are unaffected.
  if (!isAdminHost()) {
    return <ComingSoon />;
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      {/* Invite acceptance — must be reachable without an existing session. */}
      <Route path="/accept-invite" element={<AcceptInvitePage />} />

      {/* Home */}
      <Route path="/dashboard" element={<Page><HomePage /></Page>} />

      {/* Properties + Brochures */}
      <Route path="/properties" element={<Page><PropertiesPage /></Page>} />
      {/* Brochures lived as a sibling of Properties. Removed from the
          nav because it duplicated the property card's Copy / Preview
          actions; redirect the URL so old bookmarks still land somewhere
          sensible. */}
      <Route path="/brochures" element={<Navigate to="/properties" replace />} />

      {/* Operations: three distinct tabs, three distinct views.
          Enquiries shows the 8-column deal-flow kanban. Proposals shows
          a 5-column proposal-status kanban. Bookings is the calendar. */}
      <Route path="/operations" element={<Navigate to="/operations/enquiries" replace />} />
      <Route path="/operations/enquiries" element={<Page><PipelinePage /></Page>} />
      <Route path="/operations/proposals" element={<Page><ProposalsPage /></Page>} />
      <Route path="/operations/pipeline" element={<Navigate to="/operations/enquiries" replace />} />
      <Route path="/operations/bookings" element={<Page><BookingCalendarPage /></Page>} />

      {/* CRM */}
      <Route path="/crm" element={<Navigate to="/crm/guests" replace />} />
      <Route path="/crm/guests" element={<Page><GuestsPage /></Page>} />
      <Route path="/crm/home-owners" element={<Page><HomeOwnersPage /></Page>} />
      <Route path="/crm/agents" element={<Navigate to="/settings/agents" replace />} />

      {/* Finance */}
      <Route path="/finance" element={<Navigate to="/finance/contracts" replace />} />
      {/* Pricing moved to Settings — keep the old URL alive so any deep
          links / bookmarks land on the new home. */}
      <Route path="/finance/pricing" element={<Navigate to="/settings/pricing" replace />} />
      <Route path="/finance/contracts" element={<Page><SectionPlaceholder pageTitle="Contracts" title="Contracts coming soon" description="Owner agreements and guest contracts tracked alongside the property record." icon="📄" /></Page>} />
      <Route path="/finance/invoices" element={<Page><SectionPlaceholder pageTitle="Invoices" title="Invoices coming soon" description="Issue, track and reconcile invoices against bookings and owner payouts." icon="🧾" /></Page>} />

      {/* Reports */}
      <Route path="/reports" element={<Navigate to="/reports/sales" replace />} />
      <Route path="/reports/sales" element={<Page><SectionPlaceholder pageTitle="Sales" title="Sales reports coming soon" description="Conversion funnels from enquiry to booking, broken out by source and agent." icon="📈" /></Page>} />
      <Route path="/reports/business-profit" element={<Page><SectionPlaceholder pageTitle="Business Profit" title="Profit reports coming soon" description="Month-over-month revenue, commissions and net margin across the portfolio." icon="📊" /></Page>} />
      <Route path="/reports/properties" element={<Page><SectionPlaceholder pageTitle="Properties Report" title="Property reports coming soon" description="Per-property occupancy, revenue and lead-source performance." icon="🏘" /></Page>} />

      {/* Settings */}
      <Route path="/settings" element={<Navigate to="/settings/pricing" replace />} />
      <Route path="/settings/pricing" element={<Page><SettingsPage tab="pricing"><FinancePricingPage embedded /></SettingsPage></Page>} />
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
