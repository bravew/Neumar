import { useCallback } from 'react';

import { useLocation, useNavigate } from 'react-router-dom';

export function useProjectFileNavigation() {
  const location = useLocation();
  const navigate = useNavigate();

  return useCallback(
    (filePath: string) => {
      const params = new URLSearchParams(location.search);
      params.set('file', filePath);
      navigate({
        pathname: location.pathname,
        search: `?${params.toString()}`,
        hash: location.hash,
      });
    },
    [location.hash, location.pathname, location.search, navigate],
  );
}
