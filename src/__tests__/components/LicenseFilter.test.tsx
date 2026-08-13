import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { LicenseFilter } from '@/components/library/LicenseFilter';

import { renderWithProviders } from '../helpers/render-with-providers';

describe('LicenseFilter', () => {
  it('renders selected licenses as pressed chips', () => {
    renderWithProviders(
      <LicenseFilter value={['cc0']} onChange={vi.fn()} options={['cc0']} />,
    );

    expect(screen.getByRole('button', { name: 'CC0' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('adds a license when clicked', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <LicenseFilter
        value={[]}
        onChange={onChange}
        options={['cc0', 'pexels']}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Pexels' }));

    expect(onChange).toHaveBeenCalledWith(['pexels']);
  });

  it('removes a selected license when clicked', () => {
    const onChange = vi.fn();
    renderWithProviders(
      <LicenseFilter
        value={['cc0', 'pexels']}
        onChange={onChange}
        options={['cc0', 'pexels']}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'CC0' }));

    expect(onChange).toHaveBeenCalledWith(['pexels']);
  });
});
