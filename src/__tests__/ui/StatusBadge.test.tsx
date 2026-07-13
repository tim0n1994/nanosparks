import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StatusBadge from '@/components/ui/StatusBadge';

describe('StatusBadge', () => {
  it('renders completed status', () => {
    render(<StatusBadge status="COMPLETED" />);
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('renders transcribed status', () => {
    render(<StatusBadge status="TRANSCRIBED" />);
    expect(screen.getByText('Transcribed')).toBeInTheDocument();
  });

  it('renders failed status', () => {
    render(<StatusBadge status="FAILED" />);
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('renders pending status for unknown values', () => {
    render(<StatusBadge status="UNKNOWN" />);
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });
});
