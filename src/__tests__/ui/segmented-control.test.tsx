import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import SegmentedControl from '@/components/ui/SegmentedControl';

const OPTIONS = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
  { value: 'c', label: 'C' },
];

function setup(value: string) {
  const onChange = vi.fn();
  render(
    <SegmentedControl label="测试组" value={value} options={OPTIONS} onChange={onChange} />,
  );
  return onChange;
}

describe('SegmentedControl', () => {
  it('exposes a labelled radiogroup with exactly one checked radio', () => {
    setup('b');
    expect(screen.getByRole('radiogroup', { name: '测试组' })).toBeInTheDocument();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(3);
    expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: 'B' })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps only the selected option in the tab order (roving tabindex)', () => {
    setup('b');
    expect(screen.getByRole('radio', { name: 'A' })).toHaveAttribute('tabindex', '-1');
    expect(screen.getByRole('radio', { name: 'B' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'C' })).toHaveAttribute('tabindex', '-1');
  });

  it('moves selection with arrow keys', () => {
    const onChange = setup('b');
    const group = screen.getByRole('radiogroup', { name: '测试组' });

    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('c');

    onChange.mockClear();
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('wraps around at both ends', () => {
    const onChange = setup('c');
    const group = screen.getByRole('radiogroup', { name: '测试组' });

    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(onChange).toHaveBeenCalledWith('a');

    onChange.mockClear();
    fireEvent.keyDown(screen.getByRole('radiogroup', { name: '测试组' }), { key: 'ArrowUp' });
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('selects on click', () => {
    const onChange = setup('a');
    fireEvent.click(screen.getByRole('radio', { name: 'C' }));
    expect(onChange).toHaveBeenCalledWith('c');
  });

  it('uses srLabel as the accessible name when the visible label is a glyph', () => {
    render(
      <SegmentedControl
        label="字号"
        value="1"
        options={[{ value: '1', label: 'A', srLabel: '字号 15 像素' }]}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('radio', { name: '字号 15 像素' })).toBeInTheDocument();
  });
});
