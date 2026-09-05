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
      title="Upload documents"
      description={knowledgeBaseName ? `Into ${knowledgeBaseName}` : 'Choose a knowledge base after upload'}
      size="md"
      footer={
        <div className="flex items-center justify-between gap-3">
          <p className="text-tiny text-text-tertiary">
            Processing runs asynchronously — you can leave this page.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={files.length === 0 && url.trim().length === 0}>
              Start processing
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
          <p className="mt-3 text-body font-medium">Drop enterprise files here</p>
          <p className="mt-1 text-body-sm text-text-secondary">PDF / DOCX / PPTX / TXT / CSV · up to 200 MB each</p>

          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" size="sm">
              <Upload size={14} strokeWidth={1.8} aria-hidden />
              Browse
            </Button>
            <Button variant="secondary" size="sm">
              <FolderOpen size={14} strokeWidth={1.8} aria-hidden />
              Folder
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

        <Field label="Or import from a URL" hint="The crawler respects robots.txt and stores the fetched snapshot.">
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
          <p className="meta-label">Processing options</p>
          <Switch
            checked={options.autoParse}
            onCheckedChange={(checked: boolean) => setOptions({ ...options, autoParse: checked })}
            label="Auto parse"
          />
          <Switch
            checked={options.ocr}
            onCheckedChange={(checked: boolean) => setOptions({ ...options, ocr: checked })}
            label="OCR scanned pages"
          />
          <Switch
            checked={options.semanticChunking}
            onCheckedChange={(checked: boolean) => setOptions({ ...options, semanticChunking: checked })}
            label="Semantic chunking"
          />
          <Switch
            checked={options.generateMetadata}
            onCheckedChange={(checked: boolean) => setOptions({ ...options, generateMetadata: checked })}
            label="Generate metadata"
          />
          <Switch
            checked={options.generateQuestions}
            onCheckedChange={(checked: boolean) => setOptions({ ...options, generateQuestions: checked })}
            label="Generate questions (review required before publish)"
          />
        </div>

        <Field label="Chunking strategy">
          <Select
            value={strategy}
            onValueChange={setStrategy}
            options={[
              { value: 'auto', label: 'Auto — detect per document' },
              { value: 'semantic', label: 'Semantic' },
              { value: 'heading', label: 'By heading' },
              { value: 'paragraph', label: 'By paragraph' },
              { value: 'fixed_token', label: 'Fixed token window' },
              { value: 'table_aware', label: 'Table aware' },
              { value: 'faq_aware', label: 'FAQ aware' },
            ]}
          />
        </Field>
      </div>
    </Modal>
  );
}
