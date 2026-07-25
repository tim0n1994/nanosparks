import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** `flat` drops the padding so the card can host its own divided rows. */
  padding?: 'md' | 'lg' | 'flat';
}

/** The only container chrome in the app: one surface, one border, one radius. */
export default function Card({ className, padding = 'md', ...props }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl border border-line bg-surface-raised',
        padding === 'md' && 'p-4',
        padding === 'lg' && 'p-6',
        padding === 'flat' && 'overflow-hidden',
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-lg font-semibold tracking-tight text-ink', className)} {...props} />;
}
