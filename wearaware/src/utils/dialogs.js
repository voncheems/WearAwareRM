// Explicit async UI dialogs; never override browser globals or persist their contents.
export function createDialogController() {
  const queue = [];
  const listeners = new Set();
  let sequence = 0;
  const notify = () => listeners.forEach(listener => listener());
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    getSnapshot: () => queue[0]?.dialog ?? null,
    open(type, message, defaultValue = '', options = {}) {
      if (!['alert', 'confirm', 'prompt'].includes(type)) throw new Error('Unknown dialog type');
      return new Promise(resolve => {
        queue.push({ resolve, dialog: { id: ++sequence, type, message: String(message ?? ''),
          defaultValue: String(defaultValue ?? ''), title: options.title || (type === 'confirm' ? 'Confirm action' : type === 'prompt' ? 'Inspection notes' : 'WearAware notice'),
          required: options.required === true, maxLength: options.maxLength ?? 1000,
          confirmLabel: options.confirmLabel || (type === 'alert' ? 'OK, got it' : type === 'prompt' ? 'Save and continue' : 'Confirm') } });
        notify();
      });
    },
    settle(id, value) {
      const current = queue[0];
      if (!current || current.dialog.id !== id) return false;
      if (current.dialog.type === 'prompt' && value !== null
        && (typeof value !== 'string' || value.length > current.dialog.maxLength || current.dialog.required && !value.trim())) return false;
      queue.shift();
      current.resolve(current.dialog.type === 'confirm' ? value === true : current.dialog.type === 'prompt' ? value : undefined);
      notify();
      return true;
    },
  };
}

export const dialogController = createDialogController();
export const showAlert = message => dialogController.open('alert', message);
export const showConfirm = message => dialogController.open('confirm', message);
export const showPrompt = (message, defaultValue = '', options = {}) => dialogController.open('prompt', message, defaultValue, options);
