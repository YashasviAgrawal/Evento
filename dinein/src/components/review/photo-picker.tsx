'use client';

import { useEffect, useRef } from 'react';
import { Camera, X } from 'lucide-react';
import { uploadForm } from '@tixit/session';

export const MAX_REVIEW_PHOTOS = 5;
const MAX_EDGE = 1600;

export interface PickedPhoto {
  key: string;
  file: File;
  preview: string;
}

/**
 * Pick up to five photos for a review. Previews are local object URLs (freed
 * on removal and unmount); nothing uploads until the review is posted.
 */
export function PhotoPicker({ photos, onChange }: { photos: PickedPhoto[]; onChange: (photos: PickedPhoto[]) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef(photos);
  latest.current = photos;
  useEffect(() => () => latest.current.forEach((photo) => URL.revokeObjectURL(photo.preview)), []);

  function add(files: FileList | null) {
    if (!files) return;
    const room = MAX_REVIEW_PHOTOS - photos.length;
    const next = Array.from(files)
      .filter((file) => /^image\/(jpeg|png|webp)$/.test(file.type))
      .slice(0, room)
      .map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, preview: URL.createObjectURL(file) }));
    onChange([...photos, ...next]);
  }

  function remove(key: string) {
    const photo = photos.find((p) => p.key === key);
    if (photo) URL.revokeObjectURL(photo.preview);
    onChange(photos.filter((p) => p.key !== key));
  }

  return (
    <div className="mt-3">
      <ul className="flex flex-wrap gap-2">
        {photos.map((photo) => (
          <li key={photo.key} className="relative h-16 w-16 overflow-hidden rounded-xl ring-1 ring-ink-200">
            {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview, not an optimisable asset */}
            <img src={photo.preview} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => remove(photo.key)}
              className="absolute right-0.5 top-0.5 grid h-5 w-5 place-items-center rounded-full bg-ink-900/80 text-white"
              aria-label="Remove photo"
            >
              <X className="h-3 w-3" />
            </button>
          </li>
        ))}
        {photos.length < MAX_REVIEW_PHOTOS && (
          <li>
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="press grid h-16 w-16 place-items-center rounded-xl border-2 border-dashed border-ink-200 text-ink-500 hover:border-ink-300"
              aria-label="Add photos"
            >
              <Camera className="h-5 w-5" />
            </button>
          </li>
        )}
      </ul>
      <p className="mt-1.5 text-xs text-ink-500">Add up to {MAX_REVIEW_PHOTOS} photos of the food or the place.</p>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        hidden
        onChange={(event) => {
          add(event.target.files);
          event.target.value = '';
        }}
      />
    </div>
  );
}

/**
 * Phone photos are often 4–8 MB; a 1600px JPEG looks the same on any screen
 * and uploads in a fraction of the time on mobile data.
 */
async function downscale(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size < 1_500_000) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve) => canvas.toBlob((blob) => resolve(blob ?? file), 'image/jpeg', 0.85));
  } catch {
    return file;
  }
}

/** Upload in order; returns how many failed so the caller can say so. */
export async function uploadReviewPhotos(reviewId: string, photos: PickedPhoto[]): Promise<number> {
  let failed = 0;
  for (const photo of photos) {
    try {
      const form = new FormData();
      form.append('file', await downscale(photo.file), photo.file.name.replace(/\.\w+$/, '.jpg'));
      await uploadForm(`/dining/reviews/${reviewId}/photos`, form);
    } catch {
      failed += 1;
    }
  }
  return failed;
}
