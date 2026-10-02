import { useEffect, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { Menu } from 'lucide-react';

import { openSettings } from '@/components/settings/openSettings';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

import { RailItem } from './RailItem';
import { UsageActivitySheet } from './UsageActivitySheet';

// Radix handles Escape, outside click, focus return, and arrow keys, so the
// rail menu behaves like the other menus in the app.
export function RailMenu() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [usageOpen, setUsageOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <RailItem label={t.nav.menu}>
            <Menu className="size-4" />
          </RailItem>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="end" className="w-48">
          <DropdownMenuItem onSelect={() => navigate('/ideas')}>
            {t.ideas.title}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => navigate('/approvals')}>
            {t.nav.approvals}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setUsageOpen(true)}>
            {t.nav.dashboard}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openSettings()}>
            {t.nav.settings}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <UsageActivitySheet open={usageOpen} onOpenChange={setUsageOpen} />
    </>
  );
}

export function usePendingApprovalCount(): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const source = new EventSource(`${API_BASE_URL}/approvals/stream`);
    const onSnapshot = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data) as { approvals?: unknown[] };
        setCount(data.approvals?.length ?? 0);
      } catch {
        setCount(0);
      }
    };
    source.addEventListener('snapshot', onSnapshot);
    return () => {
      source.removeEventListener('snapshot', onSnapshot);
      source.close();
    };
  }, []);
  return count;
}
