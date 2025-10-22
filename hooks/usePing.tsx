// hooks/usePing.tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { AI } from '../lib/ai';

/**
 * Manual ping hook:
 * - Runs ONE initial ping on mount.
 * - No background interval (prevents UI "blinking").
 * - Debounces manual clicks (2s).
 */
export function usePing() {
  const [ok, setOk] = useState<boolean | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const lastPing = useRef<number>(0);

  const pingNow = useCallback(async () => {
    const now = Date.now();
    if (checking || now - lastPing.current < 2000) return; // 2s cooldown
    lastPing.current = now;

    setChecking(true);
    try {
      const alive = await AI.pingOllama(2500);
      setOk(alive);
    } catch {
      setOk(false);
    } finally {
      setChecking(false);
    }
  }, [checking]);

  // Initial one-shot ping
  useEffect(() => {
    pingNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ok, checking, pingNow };
}
