/* eslint-disable */
// @ts-nocheck
/**
 * SectionPlaceholder — sets the page title and renders the ComingSoon
 * card. Section sub-navigation now lives in the sidebar, so this no
 * longer touches the page-header slot.
 */
import { useEffect } from 'react';
import { useLayout } from '../contexts/LayoutContext';
import ComingSoon from '../components/ComingSoon';

export default function SectionPlaceholder({
  pageTitle,
  title,
  description,
  icon,
}: {
  pageTitle: string;
  title: string;
  description?: string;
  icon?: string;
}) {
  const { setPageTitle, setPageHeaderHidden } = useLayout();
  useEffect(() => { setPageTitle(pageTitle); }, [setPageTitle, pageTitle]);
  // Placeholder pages don't need a separate h1 above the card — the
  // card itself already serves as the page identity. Hide the header
  // while this page is mounted, restore it on unmount.
  useEffect(() => {
    setPageHeaderHidden(true);
    return () => setPageHeaderHidden(false);
  }, [setPageHeaderHidden]);
  return <ComingSoon title={title} description={description} icon={icon} />;
}
