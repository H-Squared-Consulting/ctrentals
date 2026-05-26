/* eslint-disable */
// @ts-nocheck
/**
 * Sidebar — the platform's primary navigation.
 *
 * Each top-level entry is either a direct link (Home, Settings) or a
 * group with sub-pages (Properties, Operations, CRM, Finance, Reports).
 * Groups auto-expand when the current route lives inside them so the
 * user always sees their context without having to click around.
 *
 * Active section + active sub-page get distinct highlight states so
 * "where am I?" is answerable in one glance.
 */
import { useEffect, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { openGlobalSearch } from '../lib/globalSearchEvents';

/** Sub-nav row. `restrictedTo` (when set) hides the entry from
 *  everyone except the listed emails — used for admin-only
 *  surfaces that would confuse the wider team. */
type NavChild = { to: string; label: string; restrictedTo?: string[] };

/** Emails allowed to see admin-only sidebar entries. Centralised so
 *  new admin surfaces just reuse the same allowlist. */
const ADMIN_ONLY_EMAILS = [
  'jordon@hsquared-consulting.com',
  'jordon.harrod2003@gmail.com',
];
type NavItem = {
  to: string;
  label: string;
  icon: string;
  children?: NavChild[];
  // For groups, additional paths that should also light up the parent
  // (e.g. /enquiry/new lights up Operations).
  aliases?: string[];
  // Marks the section as not yet live. Renders faded with a "Soon" pill.
  // Still clickable so curious clicks land on the placeholder page.
  comingSoon?: boolean;
};

const NAV: NavItem[] = [
  { to: '/dashboard',              label: 'Home',       icon: '🏠' },
  { to: '/operations/enquiries',   label: 'Enquiries',  icon: '📩', aliases: ['/enquiry', '/operations/pipeline'] },
  // Proposals page retired — every proposal action now lives inline
  // on the Enquiries deal modal (Send, Accept, Decline, Send all
  // drafts). The /operations/proposals route still exists as a
  // redirect so stale bookmarks don't 404.
  { to: '/operations/bookings',    label: 'Bookings',   icon: '📅' },
  { to: '/properties',             label: 'Properties', icon: '🏘', aliases: ['/brochures'] },
  { to: '/crm/people',             label: 'People',     icon: '👥', aliases: ['/crm/home-owners'] },
  { to: '/crm/guests',             label: 'Guests',     icon: '🛏' },
  { to: '/finance',                label: 'Finance',    icon: '💰', comingSoon: true },
  { to: '/reports',                label: 'Reports',    icon: '📊', comingSoon: true },
  {
    to: '/settings',
    label: 'Settings',
    icon: '⚙️',
    children: [
      { to: '/settings/pricing',     label: 'Pricing' },
      { to: '/settings/price-tiers', label: 'Price tiers', restrictedTo: ADMIN_ONLY_EMAILS },
      { to: '/settings/seasons',     label: 'Seasons' },
      { to: '/settings/platforms', label: 'Platforms' },
      { to: '/settings/agents',    label: 'Agents' },
    ],
  },
];

function matches(path: string, item: NavItem) {
  if (path === item.to || path.startsWith(item.to + '/')) return true;
  if (item.aliases) {
    for (const a of item.aliases) {
      if (path === a || path.startsWith(a + '/')) return true;
    }
  }
  return false;
}

export default function Sidebar() {
  const location = useLocation();
  const { signOut, user } = useAuth();
  const activeItem = useMemo(
    () => NAV.find(item => matches(location.pathname, item)),
    [location.pathname],
  );
  // Track which groups are open. All groups default to collapsed on
  // page load/refresh — even the active one — so the sidebar starts
  // tidy. Users open what they want by clicking.
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // Whole-sidebar collapse. Persisted to localStorage so the choice
  // sticks across refreshes/sessions.
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('sidebar.collapsed') === '1'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('sidebar.collapsed', collapsed ? '1' : '0'); } catch {}
  }, [collapsed]);

  function toggle(key: string) {
    setOpen(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <aside className={`sidebar ${collapsed ? 'is-collapsed' : ''}`}>
      <div className="sidebar-brand">
        <NavLink to="/dashboard" className="sidebar-brand-link" aria-label="Southern Escapes">
          <img
            src="/brochure-assets/se-logo.png"
            alt="Southern Escapes"
            className="sidebar-brand-logo"
          />
        </NavLink>
      </div>

      {/* Always-visible search affordance under the brand. Sits in
          the sidebar (not main-content) so it never clashes with
          page-header filters / counters on per-page boards. ⌘K
          opens the same modal from anywhere. */}
      <button
        type="button"
        className="sidebar-search"
        onClick={() => openGlobalSearch({ scope: 'properties' })}
        title="Search anything · ⌘K"
      >
        <span aria-hidden>🔍</span>
        <span className="sidebar-search__label">Search</span>
        <kbd className="sidebar-search__shortcut">⌘K</kbd>
      </button>

      <nav className="sidebar-nav">
        {NAV.map(item => {
          const isActive = matches(location.pathname, item);
          const isOpen = !!open[item.to];
          if (!item.children) {
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`sidebar-link ${isActive ? 'is-active' : ''} ${item.comingSoon ? 'is-soon' : ''}`}
              >
                <span className="sidebar-link-icon" aria-hidden>{item.icon}</span>
                <span className="sidebar-link-label">{item.label}</span>
                {item.comingSoon && <span className="sidebar-soon-tag">Soon</span>}
              </NavLink>
            );
          }
          return (
            <div key={item.to} className={`sidebar-group ${isActive ? 'is-active' : ''}`}>
              <button
                type="button"
                className={`sidebar-link sidebar-group-toggle ${isActive ? 'is-active' : ''} ${item.comingSoon ? 'is-soon' : ''}`}
                onClick={() => toggle(item.to)}
                aria-expanded={isOpen}
              >
                <span className="sidebar-link-icon" aria-hidden>{item.icon}</span>
                <span className="sidebar-link-label">{item.label}</span>
                {item.comingSoon && <span className="sidebar-soon-tag">Soon</span>}
                <span className={`sidebar-chevron ${isOpen ? 'is-open' : ''}`} aria-hidden>›</span>
              </button>
              <div className={`sidebar-children ${isOpen ? 'is-open' : ''}`}>
                {item.children
                  .filter(child => !child.restrictedTo || child.restrictedTo.includes(user?.email ?? ''))
                  .map(child => (
                    <NavLink
                      key={child.to}
                      to={child.to}
                      end
                      className={({ isActive: childActive }) => `sidebar-child ${childActive ? 'is-active' : ''}`}
                    >
                      {child.label}
                    </NavLink>
                  ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-user" title={user?.email}>{user?.email}</div>
        <button className="sidebar-signout" onClick={signOut}>Sign out</button>
        <button
          type="button"
          className="sidebar-collapse-toggle"
          onClick={() => setCollapsed(c => !c)}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span className="sidebar-collapse-icon" aria-hidden>{collapsed ? '»' : '«'}</span>
          <span className="sidebar-collapse-label">{collapsed ? 'Expand' : 'Collapse'}</span>
        </button>
      </div>
    </aside>
  );
}
