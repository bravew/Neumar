import { useEffect, useState } from 'react';

import { useNavigate } from 'react-router-dom';

import { Menu } from 'lucide-react';

import { API_BASE_URL } from '@/config';
import { useLanguage } from '@/shared/providers/language-provider';

import { RailItem } from './RailItem';

export function RailMenu() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <RailItem
        label={t.nav.menu}
        active={open}
        onSelect={() => setOpen((value) => !value)}
      >
        <Menu className="size-4" />
      </RailItem>
      {open ? (
        <div
          role="menu"
          className="border-border bg-popover absolute bottom-0 left-12 z-20 w-48 rounded-lg border p-1 shadow-md"
        >
          <MenuButton
            label={t.nav.approvals}
            onSelect={() => {
              setOpen(false);
              navigate('/approvals');
            }}
          />
          <MenuButton
            label={t.nav.dashboard}
            onSelect={() => {
              setOpen(false);
              navigate('/dashboard');
            }}
          />
          <MenuButton
            label={t.nav.settings}
            onSelect={() => {
              setOpen(false);
              window.dispatchEvent(new CustomEvent('open-settings'));
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function MenuButton({
  label,
  onSelect,
}: {
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className="hover:bg-accent w-full rounded-md px-2 py-1.5 text-left text-sm"
      onClick={onSelect}
    >
      {label}
    </button>
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
