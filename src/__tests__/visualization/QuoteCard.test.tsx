import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import QuoteCard from '@/components/visualization/QuoteCard';

describe('QuoteCard', () => {
  const mockQuote = {
    id: 'q1',
    text: 'Test quote text',
    speakerId: 's1',
    timestamp: 125,
    context: 'Test context',
  };

  const mockSpeaker = {
    id: 's1',
    name: 'Test Speaker',
    color: '#3b82f6',
    speakingTime: 1800,
  };

  it('renders quote text and speaker name', () => {
    render(<QuoteCard quote={mockQuote} speaker={mockSpeaker} />);
    expect(screen.getByText(/Test quote text/)).toBeInTheDocument();
    expect(screen.getByText(/Test Speaker/)).toBeInTheDocument();
  });

  it('displays formatted timestamp', () => {
    render(<QuoteCard quote={mockQuote} speaker={mockSpeaker} />);
    expect(screen.getByText(/2:05/)).toBeInTheDocument();
  });
});
