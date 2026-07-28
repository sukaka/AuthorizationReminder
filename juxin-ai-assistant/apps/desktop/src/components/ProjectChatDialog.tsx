import { useEffect, useRef, type RefObject } from 'react';
import { createPortal } from 'react-dom';

import { ChatPage } from '../pages/ChatPage';

type ProjectChatDialogProps = {
  projectName: string;
  projectUuid: string;
  onClose: () => void;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
};

export function ProjectChatDialog({ projectName, projectUuid, onClose, returnFocusRef }: ProjectChatDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    if (dialog && !dialog.open) {
      try {
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
      } catch {
        dialog.setAttribute('open', '');
      }
    }

    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      if (dialog?.open && typeof dialog.close === 'function') dialog.close();
      returnFocusRef.current?.focus();
    };
  }, [returnFocusRef]);

  return createPortal(
    <dialog
      aria-labelledby="project-chat-dialog-title"
      className="project-chat-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      ref={dialogRef}
    >
      <div className="project-chat-dialog-frame">
        <header className="project-chat-dialog-header">
          <div>
            <span className="project-card-kicker">项目聊天</span>
            <h2 id="project-chat-dialog-title">{projectName}</h2>
            <p>围绕当前项目整理需求、资料和交付结果。</p>
          </div>
          <button aria-label="关闭项目聊天" className="project-secondary-button" onClick={onClose} ref={closeButtonRef} type="button">关闭</button>
        </header>
        <div className="project-chat-dialog-body">
          <ChatPage key={projectUuid} initialProjectUuid={projectUuid} />
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
