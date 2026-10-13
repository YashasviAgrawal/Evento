'use client';

import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText, ImageOff, Upload } from 'lucide-react';
import { ApiError, fetchPrivateFile, uploadForm } from '@/lib/api';
import type { KycDocument } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/format';

/**
 * KYC documents are identity documents and are never served at a public URL.
 * The API streams them only to their owner and to admins, so these components
 * fetch the bytes with the bearer token and show them from an object URL.
 */

const ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
const MAX_BYTES = 5 * 1024 * 1024;

/** Thumbnail for an image, an "Open PDF" tile for a PDF; both open full size in a new tab. */
export function KycDocumentPreview({
  path,
  document,
  className,
}: {
  /** API path that streams the document, e.g. `/admin/kyc-documents/:id`. */
  path: string;
  document: KycDocument;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    fetchPrivateFile(path)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  const isPdf = document.mimeType === 'application/pdf';
  const frame = cn(
    'flex h-40 w-full items-center justify-center overflow-hidden rounded-lg border border-ink-200 bg-ink-50',
    className,
  );

  if (failed) {
    return (
      <div className={cn(frame, 'flex-col gap-1.5 text-xs text-ink-500')}>
        <ImageOff className="h-5 w-5 text-ink-400" />
        Could not load the document
      </div>
    );
  }
  if (!url) return <div className={cn(frame, 'animate-pulse')} />;

  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cn(frame, 'group relative')}>
      {isPdf ? (
        <span className="flex flex-col items-center gap-1.5 text-sm font-medium text-ink-700">
          <FileText className="h-8 w-8 text-brand-600" />
          Open PDF
        </span>
      ) : (
        // A plain <img>: next/image cannot optimise a blob: object URL.
        <img src={url} alt={document.kind === 'pan' ? 'PAN card' : 'GST certificate'} className="h-full w-full object-contain" />
      )}
      <span className="absolute right-2 top-2 hidden items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-xs font-medium text-ink-700 shadow-sm group-hover:flex">
        <ExternalLink className="h-3 w-3" />
        Full size
      </span>
    </a>
  );
}

/** Organizer-side picker: uploads straight away and hands back the stored document. */
export function KycDocumentUpload({
  kind,
  document,
  onUploaded,
  invalid,
}: {
  kind: 'pan' | 'gst';
  document: KycDocument | null;
  onUploaded: (document: KycDocument) => void;
  invalid?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) {
      setError('The file must be under 5 MB');
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append('kind', kind);
      body.append('file', file);
      onUploaded(await uploadForm<KycDocument>('/organizer/kyc/documents', body));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Upload failed, please try again');
    } finally {
      setUploading(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      {document && <KycDocumentPreview path={`/organizer/kyc/documents/${document.id}`} document={document} />}

      <div
        className={cn(
          'flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-3',
          invalid ? 'border-rose-300 bg-rose-50' : 'border-ink-300',
        )}
      >
        <Button type="button" variant="outline" size="sm" loading={uploading} onClick={() => input.current?.click()}>
          <Upload className="h-3.5 w-3.5" />
          {document ? 'Replace file' : 'Upload file'}
        </Button>
        <span className="min-w-0 flex-1 truncate text-xs text-ink-500">
          {document?.originalName ?? 'JPG, PNG, WebP or PDF · up to 5 MB'}
        </span>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
        />
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
    </div>
  );
}
