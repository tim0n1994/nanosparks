'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n/useTranslation';

interface ShowNotesProps {
  description: string | null;
  maxLines?: number;
}

export default function ShowNotes({ description }: ShowNotesProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const text = typeof description === 'string' ? description : '';
  const needsTruncation = text.length > 300;

  return (
    <div>
      <p className={`text-sm text-gray-600 leading-relaxed ${!expanded && needsTruncation ? 'line-clamp-4' : ''}`}>
        {text || ''}
      </p>
      {needsTruncation && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-primary-600 hover:text-primary-700 mt-1 font-medium"
        >
          {expanded ? t('viz.collapse') : t('viz.expand')}
        </button>
      )}
    </div>
  );
}
