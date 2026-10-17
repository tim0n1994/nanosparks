'use client';

import { useState } from 'react';
import { SlidersHorizontal, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import FeatureFlagsTab from './FeatureFlagsTab';
import UsersTab from './UsersTab';

type Tab = 'features' | 'users';

export default function AdminPanel() {
  const [tab, setTab] = useState<Tab>('features');

  return (
    <div>
      {/* Segmented tab control */}
      <div className="mb-6 inline-flex rounded-lg border border-line bg-surface-raised p-1">
        {(
          [
            ['features', '功能开关', SlidersHorizontal],
            ['users', '用户管理', Users],
          ] as const
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-4 py-1.5 text-sm font-medium transition-colors',
              tab === key ? 'bg-ink text-surface-raised' : 'text-ink-muted hover:text-ink',
            )}
          >
            <Icon aria-hidden="true" size={16} strokeWidth={1.5} />
            {label}
          </button>
        ))}
      </div>

      {tab === 'features' ? <FeatureFlagsTab /> : <UsersTab />}
    </div>
  );
}
