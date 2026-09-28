import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { PermissionDialog } from '@/components/task/PermissionDialog';
import type { PermissionRequest } from '@/shared/hooks/agent-types';

import { renderWithProviders } from '../../helpers/render-with-providers';

const basePermission: PermissionRequest = {
  id: 'perm-1',
  tool: 'Bash',
  command: 'ls',
  description: 'Execute Bash',
  risk_level: 'medium',
};

describe('PermissionDialog', () => {
  it('offers deny, allow once and always allow by default', () => {
    const onRespond = vi.fn();
    renderWithProviders(
      <PermissionDialog permission={basePermission} onRespond={onRespond} />,
    );

    expect(screen.getByRole('button', { name: 'Deny' })).not.toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Always Allow' }));
    expect(onRespond).toHaveBeenCalledWith('perm-1', 'always_allow');
    expect(
      screen.queryByText('Review carefully: this request defaults to Deny.'),
    ).not.toBeInTheDocument();
  });

  it('opens on deny when defaultToNo is set', () => {
    renderWithProviders(
      <PermissionDialog
        permission={{ ...basePermission, default_to_no: true }}
        onRespond={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'Deny' })).toHaveFocus();
    expect(
      screen.getByText('Review carefully: this request defaults to Deny.'),
    ).toBeInTheDocument();
  });

  it('hides always allow when suppressAlwaysAllowRule is set', () => {
    renderWithProviders(
      <PermissionDialog
        permission={{ ...basePermission, suppress_always_allow_rule: true }}
        onRespond={vi.fn()}
      />,
    );

    expect(
      screen.queryByRole('button', { name: 'Always Allow' }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow Once' })).toBeVisible();
  });

  it('names the MCP server serving the tool', () => {
    renderWithProviders(
      <PermissionDialog
        permission={{
          ...basePermission,
          tool: 'mcp__github__delete_repo',
          mcp_server: { name: 'github', source: 'user' },
        }}
        onRespond={vi.fn()}
      />,
    );

    expect(screen.getByText(/MCP server:\s*github/)).toBeInTheDocument();
  });
});
