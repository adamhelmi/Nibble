// hooks/useToast.ts
import { useCallback, useEffect, useState } from 'react';
import Toast from '../components/toast'; // NOTE: lowercase path, matches components/toast.tsx

export function useToast(autoHideMs = 2600) {
  const [msg, setMsg] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  const show = useCallback((m: string) => {
    setMsg(m);
    setVisible(true);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const id = setTimeout(() => setVisible(false), autoHideMs);
    return () => clearTimeout(id);
  }, [visible, autoHideMs]);

  const ToastElement = <Toast visible={visible} message={msg ?? ''} />;

  return { show, ToastElement };
}