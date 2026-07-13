'use client';

import { useTranslation } from '@/lib/i18n/useTranslation';

type SearchMode = 'keyword' | 'semantic' | 'hybrid';

interface SearchModeSelectorProps {
  mode: SearchMode;
  onChange: (mode: SearchMode) => void;
}

const MODE_OPTIONS: Array<{
  value: SearchMode;
  icon: string;
}> = [
  { value: 'keyword', icon: '🔤' },
  { value: 'semantic', icon: '🧠' },
  { value: 'hybrid', icon: '⚡' },
];

export default function SearchModeSelector({ mode, onChange }: SearchModeSelectorProps) {
  const { t } = useTranslation();

  return (
    <div>
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2">
        Search Mode
      </p>
      <div className="flex gap-2">
        {MODE_OPTIONS.map((opt) => {
          const isActive = mode === opt.value;
          const label = t(`query.mode.${opt.value}`);
          const description = t(`query.mode.${opt.value}Desc`);
          const badge = opt.value === 'hybrid' ? t('query.modeRec') : undefined;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`flex-1 flex items-center gap-2 px-3 py-2.5 rounded-lg border text-left text-sm transition-all ${
                isActive
                  ? 'bg-primary-50 border-primary-300 text-primary-800 shadow-sm'
                  : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
              }`}
              title={description}
            >
              <span className="text-base">{opt.icon}</span>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className={`font-medium ${isActive ? 'text-primary-800' : 'text-gray-700'}`}>
                    {label}
                  </span>
                  {badge && (
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                      isActive
                        ? 'bg-primary-200 text-primary-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}>
                      {badge}
                    </span>
                  )}
                </div>
                <p className={`text-[11px] mt-0.5 leading-tight ${isActive ? 'text-primary-600' : 'text-gray-400'}`}>
                  {description}
                </p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
