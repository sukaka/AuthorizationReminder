type ConfirmDialogOptions = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type PromptDialogOptions = {
  title: string;
  message?: string;
  initialValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  multiline?: boolean;
};

let dialogSequence = 0;

function showDialog(dialog: HTMLDialogElement, initialFocus: HTMLElement): void {
  document.body.append(dialog);
  try {
    dialog.showModal();
  } catch {
    dialog.setAttribute('open', '');
  }
  queueMicrotask(() => initialFocus.focus());
}

function closeDialog(dialog: HTMLDialogElement, previousFocus: HTMLElement | null): void {
  if (dialog.open && typeof dialog.close === 'function') {
    dialog.close();
  }
  dialog.remove();
  previousFocus?.focus();
}

function createDialogFrame(title: string, message?: string) {
  dialogSequence += 1;
  const titleId = `app-dialog-title-${dialogSequence}`;
  const dialog = document.createElement('dialog');
  dialog.className = 'app-dialog';
  dialog.setAttribute('aria-labelledby', titleId);

  const form = document.createElement('form');
  form.className = 'app-dialog__surface';
  form.method = 'dialog';

  const heading = document.createElement('h2');
  heading.id = titleId;
  heading.textContent = title;
  form.append(heading);

  if (message) {
    const description = document.createElement('p');
    const descriptionId = `${titleId}-description`;
    description.id = descriptionId;
    description.className = 'app-dialog__message';
    description.textContent = message;
    dialog.setAttribute('aria-describedby', descriptionId);
    form.append(description);
  }

  dialog.append(form);
  return { dialog, form };
}

export function confirmAppDialog({
  title,
  message,
  confirmLabel = '确认',
  cancelLabel = '取消',
  danger = false,
}: ConfirmDialogOptions): Promise<boolean> {
  const previousFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const { dialog, form } = createDialogFrame(title, message);
  const actions = document.createElement('div');
  actions.className = 'app-dialog__actions';

  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'app-dialog__button app-dialog__button--secondary';
  cancelButton.textContent = cancelLabel;

  const confirmButton = document.createElement('button');
  confirmButton.type = 'submit';
  confirmButton.className = danger
    ? 'app-dialog__button app-dialog__button--danger'
    : 'app-dialog__button app-dialog__button--primary';
  confirmButton.textContent = confirmLabel;
  actions.append(cancelButton, confirmButton);
  form.append(actions);

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: boolean) => {
      if (settled) return;
      settled = true;
      closeDialog(dialog, previousFocus);
      resolve(result);
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      settle(true);
    });
    cancelButton.addEventListener('click', () => settle(false));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      settle(false);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) settle(false);
    });
    showDialog(dialog, cancelButton);
  });
}

export function promptAppDialog({
  title,
  message,
  initialValue = '',
  placeholder = '',
  confirmLabel = '保存',
  cancelLabel = '取消',
  multiline = false,
}: PromptDialogOptions): Promise<string | null> {
  const previousFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  const { dialog, form } = createDialogFrame(title, message);
  const field = multiline
    ? document.createElement('textarea')
    : document.createElement('input');
  field.className = 'app-dialog__field';
  field.value = initialValue;
  field.placeholder = placeholder;
  field.setAttribute('aria-label', title);
  if (field instanceof HTMLTextAreaElement) {
    field.rows = 6;
  } else {
    field.type = 'text';
  }
  form.append(field);

  const actions = document.createElement('div');
  actions.className = 'app-dialog__actions';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'app-dialog__button app-dialog__button--secondary';
  cancelButton.textContent = cancelLabel;
  const confirmButton = document.createElement('button');
  confirmButton.type = 'submit';
  confirmButton.className = 'app-dialog__button app-dialog__button--primary';
  confirmButton.textContent = confirmLabel;
  actions.append(cancelButton, confirmButton);
  form.append(actions);

  return new Promise((resolve) => {
    let settled = false;
    const settle = (result: string | null) => {
      if (settled) return;
      settled = true;
      closeDialog(dialog, previousFocus);
      resolve(result);
    };
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      settle(field.value);
    });
    cancelButton.addEventListener('click', () => settle(null));
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      settle(null);
    });
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) settle(null);
    });
    showDialog(dialog, field);
  });
}
