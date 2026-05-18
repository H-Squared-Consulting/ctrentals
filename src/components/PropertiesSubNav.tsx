/* eslint-disable */
// @ts-nocheck
/**
 * PropertiesSubNav — pill-style toggle shown above both the Properties
 * list and the Brochures shortcut grid. The doc wants Brochures to live
 * "under Properties" in the navigation; with a top-nav layout (rather
 * than a sidebar) the closest equivalent is a sub-nav rendered on both
 * sibling pages, so they feel like two views of the same section.
 */
import { NavLink } from 'react-router-dom';

export default function PropertiesSubNav() {
  return (
    <div className="subnav">
      <NavLink to="/properties" end className={({ isActive }) => `subnav-link ${isActive ? 'active' : ''}`}>
        Properties
      </NavLink>
      <NavLink to="/brochures" className={({ isActive }) => `subnav-link ${isActive ? 'active' : ''}`}>
        Brochures
      </NavLink>
    </div>
  );
}
