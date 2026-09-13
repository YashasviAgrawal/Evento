'use client';

import { use, useEffect, useState } from 'react';
import { FileWarning } from 'lucide-react';
import { cmsApi, ApiError } from '@/lib/cms-api';
import type { AdminBlogPost } from '@/lib/types';
import { PageHeader } from '@/components/dashboard/shell';
import { PostEditor } from '@/components/cms/post-editor';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, Skeleton } from '@/components/ui/index';
import { formatDateTime } from '@/lib/format';

export default function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const [post, setPost] = useState<AdminBlogPost | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    cmsApi
      .get<AdminBlogPost>(`/posts/${id}`)
      .then((response) => {
        if (!cancelled) setPost(response.data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load this article');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-[60vh] w-full" />
      </div>
    );
  }

  if (error || !post) {
    return (
      <EmptyState
        icon={<FileWarning className="h-8 w-8" />}
        title="Article not found"
        description={error ?? 'It may have been deleted by another editor.'}
        action={<ButtonLink href="/cms/posts">Back to articles</ButtonLink>}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Edit article"
        description={
          post.publishedAt
            ? `Published ${formatDateTime(post.publishedAt)} · last updated ${formatDateTime(post.updatedAt)}`
            : `Draft · last updated ${formatDateTime(post.updatedAt)}`
        }
      />
      {/* Keyed by id so navigating between two articles remounts the form with
          the new values instead of keeping the previous one's state. */}
      <PostEditor key={post.id} post={post} />
    </>
  );
}
