/* eslint-disable */
// @ts-nocheck
/**
 * SectionSubNav — renders the inline tab labels that live in the
 * page-header slot for each top-level section. One component, table of
 * config, so adding a new sub-page is one entry.
 */
import { NavLink } from 'react-router-dom';

type Section = 'operations' | 'crm' | 'finance' | 'reports';

const SECTIONS: Record<Section, { to: string; label: string }[]> = {
  operations: [
    { to: '/operations/enquiries', label: 'Enquiries' },
    { to: '/operations/proposals', label: 'Proposals' },
    { to: '/operations/bookings', label: 'Bookings' },
  ],
  crm: [
    { to: '/crm/guests', label: 'Guests' },
    { to: '/crm/home-owners', label: 'Home Owners' },
  ],
  finance: [
    { to: '/finance/contracts', label: 'Contracts' },
    { to: '/finance/invoices', label: 'Invoices' },
  ],
  reports: [
    { to: '/reports/sales', label: 'Sales' },
    { to: '/reports/business-profit', label: 'Business Profit' },
    { to: '/reports/properties', label: 'Properties' },
  ],
};

export default function SectionSubNav({ section }: { section: Section }) {
  const links = SECTIONS[section];
  return (
    <div className="subnav">
      {links.map(l => (
        <NavLink
          key={l.to}
          to={l.to}
          className={({ isActive }) => `subnav-link ${isActive ? 'active' : ''}`}
        >
          {l.label}
        </NavLink>
      ))}
    </div>
  );
}
