const timings = new Map<string, number>();

export function startTimer(label: string): () => number {
  const start = performance.now();
  return () => {
    const duration = performance.now() - start;
    timings.set(label, duration);
    return duration;
  };
}

export function getTiming(label: string): number | undefined {
  return timings.get(label);
}

export function getAllTimings(): Record<string, number> {
  return Object.fromEntries(timings);
}
