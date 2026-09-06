'use client';

import { useState } from 'react';
import { FolderOpen, Link2, Upload } from 'lucide-react';
import { Button, Field, Input, Modal, Select, Switch } from '@/components/ui';

/**
 * §28 Upload Modal — glass modal, drag-and-drop target, three sources
 * (browse / folder / URL) and the five processing options.
 *
 * Files are sent to the API which issues signed storage URLs (§73); the browser
 * never talks to object storage with a long-lived credential.
 */
export function UploadModal({
  open,
  onOpenChange,
  knowledgeBaseName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  knowledgeBaseName?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [url, setUrl] = useState('');
  const [options, setOptions] = useState({
    autoParse: true,
    ocr: true,
    semanticChunking: true,
    generateMetadata: true,
    generateQuestions: false,
  });
  const [strategy, setStrategy] = useState('auto');

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="上傳文件"
      description={knowledgeBaseName ? `上傳至「${knowledgeBaseName}」` : '上傳完成後再選擇知識庫'}
      size="md"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-tiny text-text-tertiary">
            處理會在背景進行，你可以先離開這個頁面。
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button variant="primary" size="sm" disabled={files.length === 0 && url.trim().length === 0}>
              開始處理
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            setFiles(Array.from(event.dataTransfer.files).map((file) => file.name));
          }}
          className={`dot-matrix flex flex-col items-center justify-center rounded-card border border-dashed px-6 py-10 text-center transition-colors duration-150 ease-out-soft ${
            dragging ? 'border-accent-indigo bg-glass-card' : 'border-border-soft'
          }`}
        >
          <Upload size={22} strokeWidth={1.7} aria-hidden className="text-accent-indigo" />
          <p className="mt-3 text-body font-medium">把企業文件拖曳到這裡</p>
          <p className="mt-1 text-body-sm text-text-secondary">PDF / DOCX / PPTX / TXT / CSV · 每個檔案上限 200 MB</p>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" size="sm">
              <Upload size={14} strokeWidth={1.8} aria-hidden />
              瀏覽檔案
            </Button>
            <Button variant="secondary" size="sm">
              <FolderOpen size={14} strokeWidth={1.8} aria-hidden />
              選擇資料夾
            </Button>
          </div>
        </div>

        {files.length > 0 ? (
          <ul className="space-y-1.5 text-body-sm">
            {files.map((file) => (
              <li key={file} className="truncate rounded-card-sm border border-border-soft bg-glass-card px-3 py-2">
                {file}
              </li>
            ))}
          </ul>
        ) : null}

        <Field label="或從網址匯入" hint="爬取時會遵守 robots.txt，並保存抓取當下的快照。">
          <div className="flex items-center gap-2">
            <Link2 size={15} strokeWidth={1.8} aria-hidden className="shrink-0 text-text-tertiary" />
            <Input
              type="url"
              value={url}
              placeholder="https://intranet.example/product-sop"
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => setUrl(event.target.value)}
            />
          </div>
        </Field>

        <div className="space-y-3 border-t border-border-soft pt-4">
          <p className="meta-label">處理選項</p>
          <Switch
            checked={options.autoParse}
            onCheckedChange={(checked: boolean) => setOptions({ ...options, autoParse: checked })}
            label="自動解析"
          />
          <Switch
            checked={options.ocr}
            onCheckedChange={(checked: boolean) => setOptions({ ...options, ocr: checked })}
            label="對掃描頁面執行 OCR"
          />
          <Switch
            checked={options.semanticChunking}
            onCheckedChange={(checked: boolean) => setOptions({ ...options, semanticChunking: checked })}
            label="語意切片"
          />
          <Switch
            checked={options.generateMetadata}
            onCheckedChange={(checked: boolean) => setOptions({ ...options, generateMetadata: checked })}
            label="產生中繼資料"
          />
          <Switch
            checked={options.generateQuestions}
            onCheckedChange={(checked: boolean) => setOptions({ ...options, generateQuestions: checked })}
            label="產生問題（發布前須經人工審核）"
          />
        </div>

        <Field label="切片策略">
          <Select
            value={strategy}
            onValueChange={setStrategy}
            options={[
              { value: 'auto', label: '自動 —— 依每份文件判斷' },
              { value: 'semantic', label: '依語意' },
              { value: 'heading', label: '依標題' },
              { value: 'paragraph', label: '依段落' },
              { value: 'fixed_token', label: '固定 token 區間' },
              { value: 'table_aware', label: '表格感知' },
              { value: 'faq_aware', label: 'FAQ 感知' },
            ]}
          />
        </Field>
      </div>
    </Modal>
  );
}
