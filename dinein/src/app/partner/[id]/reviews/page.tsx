'use client';

import { use, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareText } from 'lucide-react';
import { ApiError, api } from '@tixit/session';
import { useToast } from '@tixit/ui';
import type { ReviewPhoto } from '@/lib/types';
import { ago, cn } from '@/lib/format';
import { PageHeading } from '@/components/partner/partner-shell';
import { RatingPill } from '@/components/restaurant/bits';
import { PhotoStrip } from '@/components/restaurant/photo-lightbox';
import { EmptyState, Skeleton } from '@/components/ui/feedback';

interface PartnerReview {
  id: string;
  rating: number;
  body: string | null;
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
  author: string;
  billCode: string;
  photos: ReviewPhoto[];
}

/**
 * Every review is from someone who paid here, so each one deserves an answer.
 * Replies are public on the restaurant page, under the review.
 */
export default function PartnerReviewsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [filter, setFilter] = useState<'all' | 'unreplied'>('unreplied');
  const reviews = useQuery({
    queryKey: ['partner-reviews', id, filter],
    queryFn: async () => (await api.get<PartnerReview[]>(`/partner/r/${id}/reviews`, { query: { filter } })).data,
  });

  return (
    <>
      <PageHeading title="Reviews" subtitle="From verified diners only. Your replies show publicly under each review." />
      <div className="px-4 pb-10 pt-5 sm:px-8">
        <div className="mb-4 inline-grid grid-cols-2 gap-1 rounded-2xl bg-ink-100 p-1 text-sm font-bold" role="tablist">
          {(
            [
              ['unreplied', 'Needs a reply'],
              ['all', 'All reviews'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={filter === value}
              onClick={() => setFilter(value)}
              className={cn('rounded-xl px-4 py-2', filter === value ? 'bg-white shadow-card' : 'text-ink-500')}
            >
              {label}
            </button>
          ))}
        </div>
        {reviews.isLoading ? (
          <Skeleton className="h-40 rounded-3xl" />
        ) : (reviews.data ?? []).length === 0 ? (
          <EmptyState
            icon={MessageSquareText}
            title={filter === 'unreplied' ? 'All caught up' : 'No reviews yet'}
            body={filter === 'unreplied' ? 'Every written review has a reply.' : 'Diners can review after paying their bill on Tixit.'}
          />
        ) : (
          <ul className="grid gap-3 lg:grid-cols-2">
            {reviews.data!.map((review) => (
              <ReviewCard key={review.id} restaurantId={id} review={review} />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function ReviewCard({ restaurantId, review }: { restaurantId: string; review: PartnerReview }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(!review.reply && Boolean(review.body));
  const [text, setText] = useState(review.reply ?? '');

  const save = useMutation({
    mutationFn: async (reply: string | null) => api.put(`/partner/r/${restaurantId}/reviews/${review.id}/reply`, { reply }),
    onSuccess: (_, reply) => {
      toast.success(reply ? 'Reply posted' : 'Reply removed');
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ['partner-reviews', restaurantId] });
    },
    onError: (err) => toast.error('Could not save the reply', err instanceof ApiError ? err.message : undefined),
  });

  return (
    <li className="rounded-3xl bg-white p-4 ring-1 ring-ink-200">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold">{review.author}</p>
          <p className="text-xs text-ink-500">
            {ago(review.createdAt)} · bill <span className="num">{review.billCode}</span>
          </p>
        </div>
        <RatingPill rating={review.rating} />
      </div>
      {review.body ? (
        <p className="mt-2 text-sm leading-relaxed text-ink-700">{review.body}</p>
      ) : (
        <p className="mt-2 text-sm italic text-ink-400">Rating only</p>
      )}
      {review.photos.length > 0 && (
        <div className="mt-3">
          <PhotoStrip size="sm" label={`Photos from ${review.author}`} photos={review.photos} />
        </div>
      )}
      {editing ? (
        <div className="mt-3">
          <textarea
            rows={3}
            className="input resize-none text-sm"
            value={text}
            maxLength={600}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Thank ${review.author.split(' ')[0]}, or answer what they raised`}
            aria-label="Your reply"
          />
          <div className="mt-2 flex justify-end gap-2">
            {review.reply && (
              <button onClick={() => setEditing(false)} className="press h-9 rounded-xl px-3 text-xs font-bold text-ink-600">
                Cancel
              </button>
            )}
            <button
              onClick={() => save.mutate(text.trim() || null)}
              disabled={save.isPending || (!text.trim() && !review.reply)}
              className="press h-9 rounded-xl bg-ink-900 px-4 text-xs font-bold text-white disabled:opacity-50"
            >
              {save.isPending ? 'Posting…' : text.trim() ? 'Post reply' : 'Remove reply'}
            </button>
          </div>
        </div>
      ) : review.reply ? (
        <div className="mt-3 rounded-2xl bg-ink-50 p-3 text-sm">
          <p className="text-xs font-bold text-ink-500">Your reply{review.repliedAt && ` · ${ago(review.repliedAt)}`}</p>
          <p className="mt-1 text-ink-700">{review.reply}</p>
          <button onClick={() => setEditing(true)} className="mt-2 text-xs font-bold text-brand-700">
            Edit reply
          </button>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="mt-3 text-xs font-bold text-brand-700">
          Reply
        </button>
      )}
    </li>
  );
}
