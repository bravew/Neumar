import { useEffect, useState } from 'react';

import { ATTACH_BY_PATH_EVENT } from '@/shared/lib/local-path';

/**
 * Open state for the "Attach by path" dialog. Besides the attach menu, the
 * over-limit toast opens it through `ATTACH_BY_PATH_EVENT`.
 */
export function useAttachByPath(disabled: boolean) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (disabled) return;
    const handler = () => setOpen(true);
    window.addEventListener(ATTACH_BY_PATH_EVENT, handler);
    return () => window.removeEventListener(ATTACH_BY_PATH_EVENT, handler);
  }, [disabled]);

  return { attachByPathOpen: open, setAttachByPathOpen: setOpen };
}
