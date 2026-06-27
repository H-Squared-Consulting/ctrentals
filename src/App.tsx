import { Routes, Route, Navigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './contexts/AuthContext';
import { useLayout } from './contexts/LayoutContext';
import { ModalStackProvider } from './contexts/ModalStackContext';
import { LoginPage } from './pages/LoginPage';
import PropertiesPage from './pages/PropertiesPage';
import { EnquiryForm } from './pages/EnquiryForm';
import EnquiryMatchPage from './pages/EnquiryMatchPage';
import BookingCalendarPage from './pages/BookingCalendarPage';
import SettingsPage from './pages/SettingsPage';
import LoadingSpinner from './components/LoadingSpinner';
import Fab from './components/Fab';
import GlobalSearchLauncher from './components/GlobalSearchLauncher';
import Sidebar from './components/Sidebar';
import SectionPlaceholder from './pages/SectionPlaceholder';
import PipelinePage from './pages/PipelinePage';
// ProposalsPage no longer imported — the /operations/proposals route
// is now a redirect to /operations/enquiries (see ProposalsRedirect
// below). The page file itself stays in src/pages for a release or
// two while we watch usage, then gets deleted in a follow-up.
import AgentsPage from './pages/AgentsPage';
import GuestsPage from './pages/GuestsPage';
import HomeOwnersPage from './pages/HomeOwnersPage';
import SeasonTagsPage from './pages/SeasonTagsPage';
import ChannelDefaultsPage from './pages/ChannelDefaultsPage';
import EmailTemplatesPage from './pages/EmailTemplatesPage';
import FinancePricingPage from './pages/FinancePricingPage';
import PriceTiersPage from './pages/PriceTiersPage';
import PriceListPage from './pages/PriceListPage';
import HomePage from './pages/HomePage';
import AcceptInvitePage from './pages/AcceptInvitePage';
import AgentPortalPage from './pages/AgentPortalPage';
import BookingFormPage from './pages/BookingFormPage';
import GuidebookPage from './pages/GuidebookPage';
import GuidebookEmergencyPage from './pages/GuidebookEmergencyPage';
import GuidebookListPage from './pages/GuidebookListPage';
import GuidebookEditorPage from './pages/GuidebookEditorPage';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingSpinner fullScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppLayout({ children }: { children: React.ReactNode }) {
  const { pageTitle, pageHeaderSlot, pageHeaderHidden } = useLayout();

  return (
    // ModalStackProvider coordinates the global search modal's
    // placement when another primary surface (e.g. the deal modal)
    // is also open — see contexts/ModalStackContext.tsx.
    <ModalStackProvider>
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
        {/* Always-visible global search — top-right pill + ⌘K
            shortcut. Mounted ONCE here so the modal state, keyboard
            listener and pill all live in one place; the FAB's
            "Search properties" action fires the same open event. */}
        <GlobalSearchLauncher />
      </div>
    </ModalStackProvider>
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

/** Stale-bookmark catcher for the retired /operations/proposals route.
 *  Forwards ?enquiry=<id> as ?deal=<id> on /operations/enquiries so the
 *  PipelinePage can auto-open that deal's modal on arrival. */
function ProposalsRedirect() {
  const [params] = useSearchParams();
  const enq = params.get('enquiry');
  const target = enq
    ? `/operations/enquiries?deal=${encodeURIComponent(enq)}`
    : '/operations/enquiries';
  return <Navigate to={target} replace />;
}

export function App() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingSpinner fullScreen />;

  // Gate the entire admin portal to the admin host(s). Static public
  // pages (brochure.html, proposal.html) live outside React and are
  // unaffected. The agent self-service portal at /q/:token is a React
  // route that must also render on the public domain, so allow it
  // through regardless of host.
  const isAgentPortalRoute = typeof window !== 'undefined'
    && window.location.pathname.startsWith('/q/');
  // Public guidebook viewer also renders on any host so guests can
  // open /g/:slug straight from their confirmation email regardless
  // of which domain hosts the app.
  const isGuidebookRoute = typeof window !== 'undefined'
    && window.location.pathname.startsWith('/g/');
  // Public self-serve booking detail forms (/f/:token) render on any host too.
  const isBookingFormRoute = typeof window !== 'undefined'
    && window.location.pathname.startsWith('/f/');
  if (!isAdminHost() && !isAgentPortalRoute && !isGuidebookRoute && !isBookingFormRoute) {
    return <ComingSoon />;
  }

  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      {/* Invite acceptance — must be reachable without an existing session. */}
      <Route path="/accept-invite" element={<AcceptInvitePage />} />

      {/* Public agent self-service portal. Token-gated, no admin
          chrome, renders on any host (e.g. southernescapes.co.za/q/...). */}
      <Route path="/q/:token" element={<AgentPortalPage />} />

      {/* Public self-serve booking detail form. Token-gated, no admin
          chrome, renders on any host. Writes back into booking_details. */}
      <Route path="/f/:token" element={<BookingFormPage />} />

      {/* Public per-property guidebook. Slug-addressed (e.g. /g/montrose-terrace),
          no auth, no admin chrome. RLS limits anon reads to is_published rows.
          Emergency lives at /g/:slug/emergency — deep-linkable + reachable via the FAB. */}
      <Route path="/g/:slug"           element={<GuidebookPage />} />
      <Route path="/g/:slug/emergency" element={<GuidebookEmergencyPage />} />

      {/* Home */}
      <Route path="/dashboard" element={<Page><HomePage /></Page>} />
      <Route path="/price-list" element={<Page><PriceListPage /></Page>} />

      {/* Properties + Brochures */}
      <Route path="/properties" element={<Page><PropertiesPage /></Page>} />

      {/* Guidebooks — admin editor (the public guest viewer is /g/:slug). */}
      <Route path="/guidebooks"      element={<Page><GuidebookListPage /></Page>} />
      <Route path="/guidebooks/:id"  element={<Page><GuidebookEditorPage /></Page>} />
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
      {/* /operations/proposals retired — every proposal action now lives
          inline on the Enquiries deal modal. Keep the path as a
          redirect so stale bookmarks (and old ?enquiry=<id> deep links)
          land on Enquiries instead of 404'ing. PipelinePage reads
          ?deal=<id> from the URL to auto-open that deal modal. */}
      <Route path="/operations/proposals" element={<ProposalsRedirect />} />
      <Route path="/operations/pipeline" element={<Navigate to="/operations/enquiries" replace />} />
      <Route path="/operations/bookings" element={<Page><BookingCalendarPage /></Page>} />
      {/* Actions-due queue now lives on the dashboard; redirect the old
          standalone route so stale bookmarks land on Home. */}
      <Route path="/operations/actions" element={<Navigate to="/dashboard" replace />} />

      {/* CRM */}
      <Route path="/crm" element={<Navigate to="/crm/guests" replace />} />
      <Route path="/crm/guests" element={<Page><GuestsPage /></Page>} />
      <Route path="/crm/people" element={<Page><HomeOwnersPage /></Page>} />
      <Route path="/crm/home-owners" element={<Navigate to="/crm/people" replace />} />
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
      <Route path="/settings/price-tiers" element={<Page><SettingsPage tab="price-tiers"><PriceTiersPage embedded /></SettingsPage></Page>} />
      <Route path="/settings/seasons" element={<Page><SettingsPage tab="seasons"><SeasonTagsPage embedded /></SettingsPage></Page>} />
      <Route path="/settings/platforms" element={<Page><SettingsPage tab="platforms"><ChannelDefaultsPage embedded /></SettingsPage></Page>} />
      <Route path="/settings/channels" element={<Navigate to="/settings/platforms" replace />} />
      <Route path="/settings/agents" element={<Page><SettingsPage tab="agents"><AgentsPage embedded /></SettingsPage></Page>} />
      <Route path="/settings/email-templates" element={<Page><SettingsPage tab="email-templates"><EmailTemplatesPage embedded /></SettingsPage></Page>} />

      {/* Standalone form */}
      <Route path="/enquiry/new" element={<Page><EnquiryForm /></Page>} />
      <Route path="/enquiry/new/match" element={<Page><EnquiryMatchPage /></Page>} />

      {/* Legacy URL redirects */}
      <Route path="/enquiries" element={<Navigate to="/operations/enquiries" replace />} />
      <Route path="/calendar" element={<Navigate to="/operations/bookings" replace />} />

      <Route path="*" element={<Navigate to={user ? '/dashboard' : '/login'} replace />} />
    </Routes>
  );
}
