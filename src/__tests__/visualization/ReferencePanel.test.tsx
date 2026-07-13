import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReferencePanel from '@/components/visualization/ReferencePanel';
import { ReferenceLink } from '@/types/analysis';

const mockReferences: ReferenceLink[] = [
  { id: '1', url: 'https://example.com/article', title: 'Example Article', relevanceScore: 0.95, description: 'A good article' },
  { id: '2', url: 'javascript:alert("xss")', title: 'Malicious', relevanceScore: 0.5 },
  { id: '3', url: 'https://github.com/repo', title: 'GitHub Repo', relevanceScore: 0.8 },
];

describe('ReferencePanel', () => {
  it('renders safe URLs only', () => {
    render(<ReferencePanel references={mockReferences} />);

    expect(screen.getByText('Example Article')).toBeInTheDocument();
    expect(screen.getByText('GitHub Repo')).toBeInTheDocument();
    expect(screen.queryByText('Malicious')).not.toBeInTheDocument();
  });

  it('sorts by relevance score descending', () => {
    render(<ReferencePanel references={mockReferences} />);

    const links = screen.getAllByRole('link');
    expect(links[0].getAttribute('href')).toBe('https://example.com/article');
  });

  it('renders empty when all URLs are unsafe', () => {
    const unsafe: ReferenceLink[] = [
      { id: '1', url: 'javascript:void(0)', title: 'JS', relevanceScore: 0.9 },
    ];
    render(<ReferencePanel references={unsafe} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
