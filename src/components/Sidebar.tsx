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

type NavChild = { to: string; label: string };
type NavItem = {
  to: string;
  label: string;
  icon: string;
  children?: NavChild[];
  // For groups, additional paths that should also light up the parent
  // (e.g. /enquiry/new lights up Operations).
  aliases?: string[];
};

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Home', icon: '🏠' },
  { to: '/properties', label: 'Properties', icon: '🏘', aliases: ['/brochures'] },
  {
    to: '/operations',
    label: 'Operations',
    icon: '📋',
    aliases: ['/enquiry'],
    children: [
      { to: '/operations/pipeline', label: 'Pipeline' },
      { to: '/operations/bookings', label: 'Bookings' },
    ],
  },
  {
    to: '/crm',
    label: 'CRM',
    icon: '👥',
    children: [
      { to: '/crm/guests', label: 'Guests' },
      { to: '/crm/home-owners', label: 'Home Owners' },
    ],
  },
  {
    to: '/finance',
    label: 'Finance',
    icon: '💰',
    children: [
      { to: '/finance/pricing', label: 'Pricing' },
      { to: '/finance/contracts', label: 'Contracts' },
      { to: '/finance/invoices', label: 'Invoices' },
    ],
  },
  {
    to: '/reports',
    label: 'Reports',
    icon: '📊',
    children: [
      { to: '/reports/sales', label: 'Sales' },
      { to: '/reports/business-profit', label: 'Business Profit' },
      { to: '/reports/properties', label: 'Properties' },
    ],
  },
  {
    to: '/settings',
    label: 'Settings',
    icon: '⚙️',
    children: [
      { to: '/settings/seasons', label: 'Seasons' },
      { to: '/settings/platforms', label: 'Platforms' },
      { to: '/settings/agents', label: 'Agents' },
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

  function toggle(key: string) {
    setOpen(prev => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <NavLink to="/dashboard" className="sidebar-brand-link">CT Rentals</NavLink>
      </div>

      <nav className="sidebar-nav">
        {NAV.map(item => {
          const isActive = matches(location.pathname, item);
          const isOpen = !!open[item.to];
          if (!item.children) {
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={`sidebar-link ${isActive ? 'is-active' : ''}`}
              >
                <span className="sidebar-link-icon" aria-hidden>{item.icon}</span>
                <span className="sidebar-link-label">{item.label}</span>
              </NavLink>
            );
          }
          return (
            <div key={item.to} className={`sidebar-group ${isActive ? 'is-active' : ''}`}>
              <button
                type="button"
                className={`sidebar-link sidebar-group-toggle ${isActive ? 'is-active' : ''}`}
                onClick={() => toggle(item.to)}
                aria-expanded={isOpen}
              >
                <span className="sidebar-link-icon" aria-hidden>{item.icon}</span>
                <span className="sidebar-link-label">{item.label}</span>
                <span className={`sidebar-chevron ${isOpen ? 'is-open' : ''}`} aria-hidden>›</span>
              </button>
              <div className={`sidebar-children ${isOpen ? 'is-open' : ''}`}>
                {item.children.map(child => (
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
      </div>
    </aside>
  );
}
