'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ExternalLink, FileText, Plus, Search, Trash2 } from 'lucide-react';
import { cmsApi, ApiError, type PageMeta } from '@/lib/cms-api';
import type { AdminBlogPost, BlogCategory } from '@/lib/types';
import { PageHeader } from '@/components/dashboard/shell';
import { Button, ButtonLink } from '@/components/ui/button';
import { EmptyState, Input, Select, Skeleton, StatusBadge } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { formatDateTime, formatNumber } from '@/lib/format';

const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'published', label: 'Published' },
  { key: 'draft', label: 'Drafts' },
  { key: 'archived', label: 'Archived' },
];

export default function CmsPostsPage() {
  const toast = useToast();

  const [posts, setPosts] = useState<AdminBlogPost[]>([]);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);

  // Wait for a pause in typing rather than querying on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await cmsApi.get<AdminBlogPost[]>('/posts', {
        query: {
          q: debounced || undefined,
          status: status || undefined,
          category: category || undefined,
          page,
          limit: 20,
        },
      });
      setPosts(response.data);
      setMeta(response.meta ?? null);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [debounced, status, category, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    cmsApi
      .get<BlogCategory[]>('/categories')
      .then((response) => setCategories(response.data))
      .catch(() => setCategories([]));
  }, []);

  async function remove(post: AdminBlogPost) {
    if (!window.confirm(`Delete “${post.title}”? This is permanent and breaks any link to /blog/${post.slug}.`)) {
      return;
    }
    try {
      await cmsApi.delete(`/posts/${post.id}`);
      toast.success('Article deleted');
      await load();
    } catch (err) {
      toast.error('Could not delete', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <>
      <PageHeader
        title="Articles"
        description="Create, edit and publish. Published articles appear at /blog and in the sitemap."
        actions={
          <ButtonLink href="/cms/posts/new">
            <Plus className="h-4 w-4" />
            New article
          </ButtonLink>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by title or slug…"
            className="pl-9"
          />
        </div>

        <Select
          value={category}
          onChange={(event) => {
            setCategory(event.target.value);
            setPage(1);
          }}
          className="w-auto min-w-[160px]"
        >
          <option value="">All categories</option>
          {categories.map((item) => (
            <option key={item.id} value={item.slug}>
              {item.name}
            </option>
          ))}
        </Select>

        <div className="flex flex-wrap gap-1.5">
          {STATUS_TABS.map((tab) => (
            <Button
              key={tab.key}
              size="sm"
              variant={status === tab.key ? 'secondary' : 'outline'}
              onClick={() => {
                setStatus(tab.key);
                setPage(1);
              }}
            >
              {tab.label}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <EmptyState
          icon={<FileText className="h-8 w-8" />}
          title={debounced || status || category ? 'Nothing matches those filters' : 'No articles yet'}
          description={
            debounced || status || category
              ? 'Try a different search or clear the filters.'
              : 'Articles keep earning search traffic long after an event listing has expired.'
          }
          action={
            <ButtonLink href="/cms/posts/new">
              <Plus className="h-4 w-4" />
              Write an article
            </ButtonLink>
          }
        />
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <div
              key={post.id}
              className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-ink-200 bg-white p-4 shadow-card"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={post.status} />
                  {post.isFeatured && (
                    <span className="badge bg-brand-50 text-brand-700 ring-brand-200">Featured</span>
                  )}
                  {post.category && (
                    <span className="badge bg-ink-100 text-ink-700 ring-ink-200">{post.category.name}</span>
                  )}
                </div>
                <Link
                  href={`/cms/posts/${post.id}`}
                  className="mt-2 block text-sm font-semibold text-ink-900 hover:text-emerald-700"
                >
                  {post.title}
                </Link>
                <p className="mt-1 truncate text-xs text-ink-500">
                  /blog/{post.slug} · {post.readingMinutes} min read · {formatNumber(post.viewCount)} views
                  {post.publishedAt && ` · published ${formatDateTime(post.publishedAt)}`}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                {post.status === 'published' && (
                  <a
                    href={`/blog/${post.slug}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="grid h-9 w-9 place-items-center rounded-lg text-ink-500 transition hover:bg-ink-100 hover:text-ink-800"
                    aria-label={`View ${post.title} on the site`}
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                )}
                <ButtonLink href={`/cms/posts/${post.id}`} size="sm" variant="outline">
                  Edit
                </ButtonLink>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void remove(post)}
                  aria-label={`Delete ${post.title}`}
                  className="text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {meta && meta.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-between">
          <p className="text-sm text-ink-500">
            Page {meta.page} of {meta.totalPages} · {formatNumber(meta.total)} articles
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="outline" disabled={!meta.hasNext} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
