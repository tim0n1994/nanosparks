'use client';

interface EmptyStateProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export default function EmptyState({ title = 'No data yet', description = 'Get started by adding your first item.', action }: EmptyStateProps) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-12 text-center">
      <div className="text-4xl mb-3">📭</div>
      <h3 className="text-lg font-semibold text-gray-900 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 mb-4">{description}</p>
      {action}
    </div>
  );
}
