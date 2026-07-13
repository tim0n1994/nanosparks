'use client';

interface ErrorStateProps {
  title?: string;
  message?: string;
  retry?: () => void;
}

export default function ErrorState({ title = 'Something went wrong', message = 'Please try again later.', retry }: ErrorStateProps) {
  return (
    <div className="bg-red-50 border border-red-100 rounded-xl p-8 text-center">
      <div className="text-4xl mb-3">⚠️</div>
      <h3 className="text-lg font-semibold text-red-900 mb-1">{title}</h3>
      <p className="text-sm text-red-700 mb-4">{message}</p>
      {retry && (
        <button
          onClick={retry}
          className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
}
