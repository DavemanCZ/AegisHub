export type ToastType = 'success' | 'error' | 'info';

export const toast = {
  success: (msg: string) => window.dispatchEvent(new CustomEvent('aegis-toast', { detail: { msg, type: 'success' } })),
  error: (msg: string) => window.dispatchEvent(new CustomEvent('aegis-toast', { detail: { msg, type: 'error' } })),
  info: (msg: string) => window.dispatchEvent(new CustomEvent('aegis-toast', { detail: { msg, type: 'info' } }))
};
