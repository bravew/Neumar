/**
 * MCP Server Selector
 *
 * Toolbar button + popover for selecting which MCP servers to include
 * in the current message. Appears in the ChatInput bottom toolbar.
 *
 * Two interaction modes:
 *   1. Toolbar button — click to open a popover listing all configured servers.
 *      Toggle servers on/off. Selections are per-message.
 *   2. @mention — typing "@" in the textarea triggers `onRequestOpen` so the
 *      parent can open this popover programmatically for inline selection.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { Check, Search } from 'lucide-react';

import type { McpServerInfo } from '@/shared/hooks/useMcpServers';
import { cn } from '@/shared/lib/utils';
import { useLanguage } from '@/shared/providers/language-provider';

/** MCP protocol icon — uses currentColor so it follows the parent text color (light/dark). */
export function McpIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="currentColor"
      fillRule="evenodd"
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M15.688 2.343a2.588 2.588 0 00-3.61 0l-9.626 9.44a.863.863 0 01-1.203 0 .823.823 0 010-1.18l9.626-9.44a4.313 4.313 0 016.016 0 4.116 4.116 0 011.204 3.54 4.3 4.3 0 013.609 1.18l.05.05a4.115 4.115 0 010 5.9l-8.706 8.537a.274.274 0 000 .393l1.788 1.754a.823.823 0 010 1.18.863.863 0 01-1.203 0l-1.788-1.753a1.92 1.92 0 010-2.754l8.706-8.538a2.47 2.47 0 000-3.54l-.05-.049a2.588 2.588 0 00-3.607-.003l-7.172 7.034-.002.002-.098.097a.863.863 0 01-1.204 0 .823.823 0 010-1.18l7.273-7.133a2.47 2.47 0 00-.003-3.537z" />
      <path d="M14.485 4.703a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a4.115 4.115 0 000 5.9 4.314 4.314 0 006.016 0l7.12-6.982a.823.823 0 000-1.18.863.863 0 00-1.204 0l-7.119 6.982a2.588 2.588 0 01-3.61 0 2.47 2.47 0 010-3.54l7.12-6.982z" />
    </svg>
  );
}

// ────────────────────────────────────────────────────────────────────
// Props
// ────────────────────────────────────────────────────────────────────

export interface McpSelectorProps {
  /** All configured MCP servers from the backend. */
  servers: McpServerInfo[];
  /** Currently selected server names for this message. */
  selected: string[];
  /** Called when a server is toggled on or off. */
  onToggle: (serverName: string) => void;
  /** Whether the input is disabled (agent running, etc.). */
  disabled?: boolean;
  /** Compact mode for the reply variant. */
  compact?: boolean;
  /** Whether the popover should be forced open (e.g. from @mention). */
  forceOpen?: boolean;
  /** Called when the popover closes (so parent can clear forceOpen). */
  onClose?: () => void;
  /** Filter text from @mention (characters typed after "@"). */
  mentionFilter?: string;
}

// ────────────────────────────────────────────────────────────────────
// Component
// ────────────────────────────────────────────────────────────────────

export function McpSelector({
  servers,
  selected,
  onToggle,
  disabled = false,
  compact = false,
  forceOpen = false,
  onClose,
  mentionFilter = '',
}: McpSelectorProps) {
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [localFilter, setLocalFilter] = useState('');
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Sync forceOpen from parent (@mention trigger)
  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
      setLocalFilter('');
    } else {
      setOpen(false);
    }
  }, [forceOpen]);

  // Close on click outside — use ref for onClose to avoid listener churn
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
        onCloseRef.current?.();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleToggle = useCallback(
    (name: string) => {
      onToggle(name);
    },
    [onToggle],
  );

  // Combine local search with @mention filter
  const filterText = mentionFilter || localFilter;
  const filtered = filterText
    ? servers.filter((s) =>
        s.name.toLowerCase().includes(filterText.toLowerCase()),
      )
    : servers;

  if (servers.length === 0) return null;

  return (
    <div className="relative">
      {/* Toolbar Button */}
      <button
        ref={buttonRef}
        type="button"
        onClick={() => {
          if (open) {
            setOpen(false);
            onClose?.();
          } else {
            setOpen(true);
            setLocalFilter('');
          }
        }}
        disabled={disabled}
        className={cn(
          'relative flex items-center justify-center transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
          compact
            ? 'text-muted-foreground hover:bg-accent hover:text-foreground size-7 rounded-md'
            : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground size-8 rounded-full border',
          selected.length > 0 && 'text-foreground',
        )}
        aria-label={t.home.mcpServers}
      >
        <McpIcon className="size-4" />
        {/* Badge */}
        {selected.length > 0 && (
          <span className="bg-foreground text-background absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full text-[9px] leading-none font-medium">
            {selected.length}
          </span>
        )}
      </button>

      {/* Popover */}
      {open && (
        <div
          ref={popoverRef}
          className={cn(
            'border-border bg-popover absolute bottom-full left-0 z-50 mb-2 w-64 rounded-xl border shadow-lg',
            'animate-in fade-in-0 zoom-in-95 slide-in-from-bottom-2',
          )}
        >
          {/* Header */}
          <div className="border-border flex items-center gap-2 border-b px-3 py-2.5">
            <McpIcon className="text-muted-foreground size-3.5" />
            <span className="text-foreground text-sm font-medium">
              {t.home.mcpServers}
            </span>
          </div>

          {/* Search (only show when 5+ servers) */}
          {servers.length >= 5 && !mentionFilter && (
            <div className="border-border border-b px-3 py-2">
              <div className="relative">
                <Search className="text-muted-foreground absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
                <input
                  type="text"
                  value={localFilter}
                  onChange={(e) => setLocalFilter(e.target.value)}
                  placeholder={t.settings.mcpSearch}
                  className="bg-muted/50 text-foreground placeholder:text-muted-foreground h-7 w-full rounded-md pr-2 pl-7 text-xs focus:outline-none"
                  autoFocus
                />
              </div>
            </div>
          )}

          {/* Server List */}
          <div className="max-h-[280px] overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <div className="text-muted-foreground px-3 py-4 text-center text-xs">
                {t.home.mcpNoServersConfigured}
              </div>
            ) : (
              filtered.map((server) => {
                const isSelected = selected.includes(server.name);
                return (
                  <button
                    key={`${server.source}-${server.name}`}
                    type="button"
                    onClick={() => handleToggle(server.name)}
                    className={cn(
                      'hover:bg-accent flex w-full items-center gap-3 px-3 py-2 text-left transition-colors',
                    )}
                  >
                    {/* Server icon or placeholder */}
                    <div className="flex size-6 shrink-0 items-center justify-center">
                      {server.icon ? (
                        <img
                          src={server.icon}
                          alt=""
                          className="size-5 rounded object-contain"
                        />
                      ) : (
                        <div className="bg-muted text-muted-foreground flex size-5 items-center justify-center rounded text-[10px] font-medium uppercase">
                          {server.name.charAt(0)}
                        </div>
                      )}
                    </div>

                    {/* Name + type badge */}
                    <div className="min-w-0 flex-1">
                      <span className="text-foreground block truncate text-sm">
                        {server.name}
                      </span>
                    </div>

                    {/* Check / @ indicator */}
                    {isSelected ? (
                      <Check className="text-foreground size-4 shrink-0" />
                    ) : (
                      <span className="text-muted-foreground text-xs">@</span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
