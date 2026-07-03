import { useEffect, useRef, useState } from 'react';

import { uploadTaskAttachment, type AttachmentPayload } from '../api/client';

type AttachmentUploadProps = {
  taskUuid: string;
  onChange: (attachments: AttachmentPayload[]) => void;
  onUploadingChange?: (uploading: boolean) => void;
};

type UploadingItem = {
  id: string;
  fileName: string;
};

export function AttachmentUpload({
  taskUuid,
  onChange,
  onUploadingChange,
}: AttachmentUploadProps) {
  const [items, setItems] = useState<AttachmentPayload[]>([]);
  const [uploadingItems, setUploadingItems] = useState<UploadingItem[]>([]);
  const [error, setError] = useState('');
  const nextUploadId = useRef(0);

  useEffect(() => {
    onChange(items);
  }, [items, onChange]);

  useEffect(() => {
    onUploadingChange?.(uploadingItems.length > 0);
  }, [onUploadingChange, uploadingItems.length]);

  const upload = async (file: File) => {
    const uploadId = String(nextUploadId.current);
    nextUploadId.current += 1;
    setError('');
    setUploadingItems((current) => current.concat({ id: uploadId, fileName: file.name }));
    try {
      const item = await uploadTaskAttachment(taskUuid, file);
      setItems((current) => current.concat(item));
    } catch {
      setError('文件上传失败，请确认文件类型和大小后重试');
    } finally {
      setUploadingItems((current) => current.filter((item) => item.id !== uploadId));
    }
  };

  return (
    <section className="attachment-upload">
      <label>
        <span>参考材料（可选）</span>
        <small>支持 docx、xlsx、pptx、txt、md。文件内容会作为参考材料参与生成。</small>
        <span className="file-picker">
          <span className="file-picker-button">选择文件</span>
          <span className="file-picker-name">未选择文件</span>
          <input
            accept=".docx,.xlsx,.pptx,.txt,.md,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.openxmlformats-officedocument.presentationml.presentation"
            aria-label="上传参考材料"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.currentTarget.value = '';
            }}
            type="file"
          />
        </span>
      </label>
      {uploadingItems.map((item) => (
        <p className="attachment-status" key={item.id}>{item.fileName} 上传中…</p>
      ))}
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
