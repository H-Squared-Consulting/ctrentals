import { useAuth } from '../contexts/AuthContext';

interface PagePermissionResult {
  canAccess: boolean;
  isLoading: boolean;
}

export function usePagePermission(): PagePermissionResult {
  const { user, loading } = useAuth();

  if (loading) return { canAccess: true, isLoading: true };
  if (!user) return { canAccess: false, isLoading: false };

  return { canAccess: true, isLoading: false };
}

export default usePagePermission;
