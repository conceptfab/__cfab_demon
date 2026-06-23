import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { Badge } from '@/components/ui/badge';

describe('Badge', () => {
  it('renders children', () => {
    render(<Badge>TIMEFLOW</Badge>);
    expect(screen.getByText('TIMEFLOW')).toBeTruthy();
  });

  it('renders with default variant', () => {
    render(<Badge>v1.0</Badge>);
    const el = screen.getByText('v1.0');
    expect(el.tagName.toLowerCase()).toBe('div');
  });
});
