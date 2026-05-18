/* eslint-disable */
// @ts-nocheck
/**
 * SettingsPage — currently surfaces business-wide configuration. Agents
 * moved to CRM (per the navigation spec), so Seasons is the only
 * setting today; inlined here without a tab bar.
 */

import { useEffect } from 'react';
import { useLayout } from '../contexts/LayoutContext';
import SeasonTagsPage from './SeasonTagsPage';

export default function SettingsPage() {
  const { setPageTitle } = useLayout();
  useEffect(() => { setPageTitle('Settings'); }, [setPageTitle]);
  return <SeasonTagsPage embedded />;
}
