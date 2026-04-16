/* eslint-disable */
// @ts-nocheck
/**
 * SettingsPage -- Groups Seasons, Agents, and Brochures as tabs
 */

import { useState, useEffect } from 'react';
import { useLayout } from '../contexts/LayoutContext';
import SeasonTagsPage from './SeasonTagsPage';
import AgentsPage from './AgentsPage';
import BrochuresPage from './BrochuresPage';

export default function SettingsPage() {
  const { setPageTitle } = useLayout();
  const [activeTab, setActiveTab] = useState<'seasons' | 'agents' | 'brochures'>('seasons');

  useEffect(() => { setPageTitle('Settings'); }, [setPageTitle]);

  return (
    <div>
      <div className="page-tabs">
        <button className={`page-tab ${activeTab === 'seasons' ? 'active' : ''}`} onClick={() => setActiveTab('seasons')}>
          Seasons
        </button>
        <button className={`page-tab ${activeTab === 'agents' ? 'active' : ''}`} onClick={() => setActiveTab('agents')}>
          Agents
        </button>
        <button className={`page-tab ${activeTab === 'brochures' ? 'active' : ''}`} onClick={() => setActiveTab('brochures')}>
          Brochures
        </button>
      </div>

      {activeTab === 'seasons' && <SeasonTagsPage embedded />}
      {activeTab === 'agents' && <AgentsPage embedded />}
      {activeTab === 'brochures' && <BrochuresPage embedded />}
    </div>
  );
}
