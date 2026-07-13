"use client";

interface LoadingSpinnerProps {
  text?: string;
}

export default function LoadingSpinner({ text = "加载中..." }: LoadingSpinnerProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
