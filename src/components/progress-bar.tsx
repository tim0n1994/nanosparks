"use client";

import { useEffect, useState } from "react";

interface ProgressBarProps {
  episodeId: string;
  status: string;
  onComplete?: () => void;
}

const statusOrder = [
  "PENDING",
  "DOWNLOADING",
  "TRANSCRIBING",
  "ANALYZING",
  "COMPLETED",
  "FAILED",
];

function getProgressPercent(status: string): number {
  const idx = statusOrder.indexOf(status);
  if (idx === -1) return 0;
  if (status === "FAILED") return 0;
  return Math.min(100, (idx / 4) * 100);
}

function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: "等待处理",
    DOWNLOADING: "下载音频中...",
    TRANSCRIBING: "语音识别中...",
    ANALYZING: "AI 分析中...",
    COMPLETED: "分析完成",
    FAILED: "处理失败",
  };
  return labels[status] || status;
}

export default function ProgressBar({ episodeId, status, onComplete }: ProgressBarProps) {
  const [progress, setProgress] = useState(getProgressPercent(status));
  const [currentStatus, setCurrentStatus] = useState(status);

  useEffect(() => {
    setCurrentStatus(status);
    setProgress(getProgressPercent(status));

    if (status === "COMPLETED") {
      onComplete?.();
      return;
    }
    if (status === "FAILED" || status === "COMPLETED") {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/episodes/${episodeId}`);
        if (!res.ok) return;
        const data = await res.json();
        const newStatus = data.status || status;
        setCurrentStatus(newStatus);
        setProgress(getProgressPercent(newStatus));

        if (newStatus === "COMPLETED") {
          clearInterval(interval);
          onComplete?.();
        }
        if (newStatus === "FAILED") {
          clearInterval(interval);
        }
      } catch {
        // ignore polling errors
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [episodeId, status, onComplete]);

  return (
    <div className="w-full">
      <div className="flex justify-between text-xs text-muted-foreground mb-1">
        <span>{getStatusLabel(currentStatus)}</span>
        <span>{Math.round(progress)}%</span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all duration-500 ease-out rounded-full"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
