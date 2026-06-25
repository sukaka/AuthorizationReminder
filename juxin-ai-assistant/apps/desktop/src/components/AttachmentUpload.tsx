import { useState } from 'react';

import { uploadTaskAttachment, type AttachmentPayload } from '../api/client';

type AttachmentUploadProps = {
  taskUuid: string;
  onChange: (attachments: AttachmentPayload[]) => void;
};

export function AttachmentUpload({ taskUuid, onChange }: AttachmentUploadProps) {
  const [items, setItems] = useState<AttachmentPayload[]>([]);
  const [uploadingFileName, setUploadingFileName] = useState('');
  const [error, setError] = useState('');

  const upload = async (file: File) => {
    setError('');
    setUploadingFileName(file.name);
    try {
      const item = await uploadTaskAttachment(taskUuid, file);
      setItems((current) => {
        const next = current.concat(item);
        onChange(next);
        return next;
      });
    } catch {
      setError('文件上传失败，请确认文件类型和大小后重试');
    } finally {
      setUploadingFileName('');
    }
  };

  return (
    <section className="attachment-upload">
      <label>
        <span>参考材料（可选）</span>
        <small>支持 txt、md。文件内容会作为参考材料参与生成。</small>
        <input
          accept=".txt,.md,text/plain,text/markdown"
          aria-label="上传参考材料"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.currentTarget.value = '';
          }}
          type="file"
        />
      </label>
      {uploadingFileName ? <p className="attachment-status">{uploadingFileName} 上传中…</p> : null}
      {items.length ? (
        <ul>
          {items.map((item) => (
            <li key={item.attachment_uuid}>
              <strong>{item.file_name}</strong>
              <span>{item.status === 'READY' ? '已解析' : item.status || '已上传'}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
    </section>
  );
}
