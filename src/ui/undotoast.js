// After a destructive action: a toast with an Undo button. It undoes only while that action is still the latest step,
// so a late click never undoes something else.
import { t } from './i18n.js';
import { toast } from './controls.js';
import { lastUndoStep, emit } from '../app/store.js';

export function undoToast(msg) {
  const step = lastUndoStep();
  toast(msg, 'info', 6000, {
    label: t('Undo'),
    onClick: () => { if (step && lastUndoStep() === step) emit('undo-request', false); else toast(t('Other changes came after it: use Undo in the top bar'), 'info'); },
  });
}
