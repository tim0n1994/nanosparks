import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import StatusBadge from '@/components/ui/StatusBadge';
import { statusView } from '@/lib/status';

/**
 * The badge reads the single vocabulary in lib/status and defaults to Chinese,
 * matching the rest of the product. English is opt-in via `lang`.
 */
describe('StatusBadge', () => {
  it('renders the ready label for completed', () => {
    render(<StatusBadge status="COMPLETED" />);
    expect(screen.getByText('可读')).toBeInTheDocument();
  });

  it('treats transcribed as readable', () => {
    render(<StatusBadge status="TRANSCRIBED" />);
    expect(screen.getByText('可读')).toBeInTheDocument();
  });

  it('renders failed status', () => {
    render(<StatusBadge status="FAILED" />);
    expect(screen.getByText('失败')).toBeInTheDocument();
  });

  it('renders English when lang is en', () => {
    render(<StatusBadge status="COMPLETED" lang="en" />);
    expect(screen.getByText('Ready')).toBeInTheDocument();
  });

  it('falls back to a working label for unrecognised statuses', () => {
    render(<StatusBadge status="SOMETHING_NEW" />);
    expect(screen.getByText('处理中')).toBeInTheDocument();
  });

  it('maps a missing status to queued rather than throwing', () => {
    expect(statusView(null).tone).toBe('queued');
    expect(statusView(undefined).label).toBe('排队中');
  });
});
