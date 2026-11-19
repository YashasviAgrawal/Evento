'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EyeOff, Images, RotateCcw } from 'lucide-react';
import { api } from '@tixit/session';
import { useToast } from '@tixit/ui';
import { ago, cn } from '@/lib/format';
import { Photo } from '@/components/ui/photo';
import { Sheet } from '@/components/ui/sheet';
import { EmptyState, Skeleton } from '@/components/ui/feedback';

interface ModerationPhoto {
  id: string;
  url: string;
  status: 'visible' | 'hidden';
  hiddenReason: string | null;
  createdAt: string;
  restaurant: { name: string; slug: string };
  author: string;
}

const REASONS = ['Not of the food or the place', 'Shows a person without consent', 'Offensive or inappropriate', 'Spam or advertising', 'Low quality or duplicate'];

/**
 * Diner photos publish immediately (the diner paid, so the visit is real);
 * this is where the team takes down the ones that should not stay up.
 */
export default function AdminPhotosPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<'visible' | 'hidden'>('visible');
  const [hiding, setHiding] = useState<ModerationPhoto | null>(null);
  const [reason, setReason] = useState(REASONS[0]!);

  const photos = useQuery({
    queryKey: ['admin-photos', status],
    queryFn: async () => (await api.get<ModerationPhoto[]>('/admin/dining/photos', { query: { status } })).data,
  });

  const moderate = useMutation({
    mutationFn: async (input: { id: string; status: 'visible' | 'hidden'; reason?: string }) => api.patch(`/admin/dining/photos/${input.id}`, input),
    onSuccess: (_, input) => {
      toast.success(input.status === 'hidden' ? 'Photo hidden' : 'Photo restored');
      setHiding(null);
      void queryClient.invalidateQueries({ queryKey: ['admin-photos'] });
    },
    onError: (e) => toast.error('Could not update', e instanceof Error ? e.message : undefined),
  });

  return (
    <div className="px-4 py-6 sm:px-8 sm:py-8">
      <h1 className="text-2xl font-extrabold tracking-tight">Diner photos</h1>
      <p className="text-sm text-ink-500">Newest first. Hiding a photo removes it from the restaurant page; the diner keeps their review.</p>

      <div className="mt-5 inline-flex rounded-full bg-ink-100 p-1 text-sm font-bold">
        {(
          [
            ['visible', 'Live'],
            ['hidden', 'Hidden'],
          ] as const
        ).map(([value, label]) => (
          <button key={value} onClick={() => setStatus(value)} className={cn('rounded-full px-4 py-2', status === value ? 'bg-white shadow-card' : 'text-ink-500')}>
            {label}
          </button>
        ))}
      </div>

      <div className="mt-4">
        {photos.isLoading ? (
          <Skeleton className="h-48 rounded-3xl" />
        ) : (photos.data ?? []).length === 0 ? (
          <EmptyState icon={Images} title="Nothing here" body={status === 'visible' ? 'Diner photos appear as they are posted.' : 'No hidden photos.'} />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.data!.map((photo) => (
              <li key={photo.id} className="overflow-hidden rounded-2xl bg-white ring-1 ring-ink-200">
                <a href={photo.url} target="_blank" rel="noreferrer" className="block">
                  <Photo src={photo.url} alt="" sizes="(min-width: 1024px) 25vw, 50vw" className="aspect-square" />
                </a>
                <div className="p-3">
                  <p className="truncate text-sm font-bold">{photo.restaurant.name}</p>
                  <p className="truncate text-xs text-ink-500">
                    {photo.author} · {ago(photo.createdAt)}
                  </p>
                  {photo.hiddenReason && <p className="mt-1 text-xs text-rose-700">{photo.hiddenReason}</p>}
                  {photo.status === 'visible' ? (
                    <button
                      onClick={() => {
                        setReason(REASONS[0]!);
                        setHiding(photo);
                      }}
                      className="press mt-2 inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-bold text-rose-700 ring-1 ring-inset ring-rose-200"
                    >
                      <EyeOff className="h-3.5 w-3.5" /> Hide
                    </button>
                  ) : (
                    <button
                      onClick={() => moderate.mutate({ id: photo.id, status: 'visible' })}
                      className="press mt-2 inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-bold ring-1 ring-inset ring-ink-200"
                    >
                      <RotateCcw className="h-3.5 w-3.5" /> Restore
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Sheet
        open={Boolean(hiding)}
        onClose={() => setHiding(null)}
        title="Hide this photo"
        subtitle={hiding ? `From ${hiding.author} at ${hiding.restaurant.name}` : undefined}
        footer={
          <button
            onClick={() => hiding && moderate.mutate({ id: hiding.id, status: 'hidden', reason })}
            disabled={moderate.isPending}
            className="press mb-1 h-12 w-full rounded-2xl bg-rose-600 font-bold text-white disabled:opacity-60"
          >
            {moderate.isPending ? 'Hiding…' : 'Hide photo'}
          </button>
        }
      >
        <fieldset className="space-y-2 pt-1">
          <legend className="label">Reason (kept in the audit log)</legend>
          {REASONS.map((option) => (
            <label key={option} className={cn('flex cursor-pointer items-center gap-3 rounded-2xl p-3 text-sm ring-1 ring-inset', reason === option ? 'bg-ink-900 text-white ring-ink-900' : 'ring-ink-200')}>
              <input type="radio" name="reason" value={option} checked={reason === option} onChange={() => setReason(option)} className="sr-only" />
              {option}
            </label>
          ))}
        </fieldset>
      </Sheet>
    </div>
  );
}
