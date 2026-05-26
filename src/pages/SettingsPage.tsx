/* eslint-disable */
// @ts-nocheck
/**
 * SettingsPage — thin wrapper. Sub-pages (Seasons, Channels) live in the
 * sidebar dropdown now, so this just sets the page title from the active
 * route and renders whatever child the route hands it.
 */

import { useEffect, type ReactNode } from 'react';
import { useLayout } from '../contexts/LayoutContext';

const TITLES: Record<string, string> = {
  pricing:        'Pricing',
  'price-tiers':  'Price tiers',
  seasons:        'Seasons',
  platforms:      'Platforms',
  agents:         'Agents',
};

export default function SettingsPage({ tab, children }: { tab: 'pricing' | 'price-tiers' | 'seasons' | 'platforms' | 'agents'; children: ReactNode }) {
  const { setPageTitle } = useLayout();
  useEffect(() => { setPageTitle(TITLES[tab] || 'Settings'); }, [setPageTitle, tab]);
  return <>{children}</>;
}
