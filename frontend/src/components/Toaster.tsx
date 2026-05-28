import { useEffect, useState } from 'react';
import { ToastType } from '../lib/toast';

export function Toaster() {
  const [toasts, setToasts] = useState<{ id: number; msg: string; type: ToastType }[]>([]);

  useEffect(() => {
    const handleToast = (e: any) => {
      const id = Date.now() + Math.random();
      setToasts(prev => [...prev, { id, msg: e.detail.msg, type: e.detail.type }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 4000);
    };
    window.addEventListener('aegis-toast', handleToast);
    return () => window.removeEventListener('aegis-toast', handleToast);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div style={{ position: 'fixed', bottom: 20, right: 20, display: 'flex', flexDirection: 'column', gap: '0.6rem', zIndex: 99999 }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type === 'error' ? '#ef4444' : t.type === 'success' ? '#10b981' : '#3b82f6',
          color: 'white', padding: '0.8rem 1.2rem', borderRadius: '0.5rem',
          boxShadow: '0 10px 15px -3px rgba(0,0,0,0.2)', fontSize: '0.9rem',
          fontWeight: 500,
          animation: 'slideIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards'
        }}>
          {t.msg}
        </div>
      ))}
    </div>
  );
}
