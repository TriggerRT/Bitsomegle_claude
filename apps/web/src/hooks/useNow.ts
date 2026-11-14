import { useEffect, useState } from 'react';

/**
 * The current time, refreshed every `intervalMs`. A component that shows a countdown uses
 * this so that React re-draws it as time passes.
 */
export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
