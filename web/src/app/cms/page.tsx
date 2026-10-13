'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Archive, Eye, FileEdit, FileText, FolderTree, Plus } from 'lucide-react';
import { cmsApi } from '@/lib/cms-api';
import type { AdminBlogPost, CmsActivity, CmsStats } from '@/lib/types';
import { useCmsAuth } from '@/components/providers/cms-auth-provider';
import { PageHeader, StatCard } from '@/components/dashboard/shell';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState, Skeleton, StatusBadge } from '@/components/ui/index';
import { formatDateTime, formatNumber, friendlyDate } from '@/lib/format';

/** Reads better than a raw `post.published` action string in the feed. */
const ACTION_LABELS: Record<string, string> = {
  'post.created': 'created',
  'post.updated': 'edited',
  'post.published': 'published',
  'post.deleted': 'deleted',
  'category.created': 'added the category',
  'category.updated': 'renamed the category',
  'category.deleted': 'removed the category',
  'cms_user.created': 'added the account',
  'cms_user.updated': 'updated the account',
  'cms_user.deleted': 'removed the account',
  'cms.password_changed': 'changed their password',
  'cms.signed_in': 'signed in',
};

export default function CmsDashboardPage() {
  const { user } = useCmsAuth();

  const [stats, setStats] = useState<CmsStats | null>(null);
  const [recent, setRecent] = useState<AdminBlogPost[]>([]);
  const [activity, setActivity] = useState<CmsActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const [statsResult, postsResult, activityResult] = await Promise.allSettled([
        cmsApi.get<CmsStats>('/stats'),
        cmsApi.get<AdminBlogPost[]>('/posts', { query: { limit: 5, page: 1 } }),
        cmsApi.get<CmsActivity[]>('/activity', { query: { limit: 8 } }),
      ]);

      if (cancelled) return;
      if (statsResult.status === 'fulfilled') setStats(statsResult.value.data);
      if (postsResult.status === 'fulfilled') setRecent(postsResult.value.data);
      if (activityResult.status === 'fulfilled') setActivity(activityResult.value.data);
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <PageHeader
        title={`Hello, ${user?.fullName.split(' ')[0] ?? 'there'}`}
        description="Everything published here appears on the public blog and in the sitemap."
        actions={
          <ButtonLink href="/cms/posts/new">
            <Plus className="h-4 w-4" />
            New article
          </ButtonLink>
        }
      />

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-24 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Published"
            value={formatNumber(stats?.published ?? 0)}
            hint="Live on /blog"
            icon={<FileText className="h-4 w-4" />}
            tone="success"
          />
          <StatCard
            label="Drafts"
            value={formatNumber(stats?.draft ?? 0)}
            hint="Not visible to readers"
            icon={<FileEdit className="h-4 w-4" />}
            tone="warning"
          />
          <StatCard
            label="Total views"
            value={formatNumber(stats?.totalViews ?? 0)}
            hint="Across every article"
            icon={<Eye className="h-4 w-4" />}
            tone="brand"
          />
          <StatCard
            label="Categories"
            value={formatNumber(stats?.categories ?? 0)}
            hint={`${formatNumber(stats?.archived ?? 0)} archived articles`}
            icon={<FolderTree className="h-4 w-4" />}
          />
        </div>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* ── Recently edited ── */}
        <section>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink-900">Recently updated</h2>
            <Link href="/cms/posts" className="text-xs font-medium text-emerald-700 hover:text-emerald-800">
              View all articles
            </Link>
          </div>

          {loading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton key={index} className="h-16 w-full" />
              ))}
            </div>
          ) : recent.length === 0 ? (
            <EmptyState
              icon={<FileText className="h-8 w-8" />}
              title="No articles yet"
              description="Articles keep earning search traffic long after an event listing has expired."
              action={
                <ButtonLink href="/cms/posts/new">
                  <Plus className="h-4 w-4" />
                  Write the first one
                </ButtonLink>
              }
            />
          ) : (
            <ul className="space-y-3">
              {recent.map((post) => (
                <li key={post.id}>
                  <Link
                    href={`/cms/posts/${post.id}`}
                    className="flex items-start justify-between gap-4 rounded-xl border border-ink-200 bg-white p-4 shadow-card transition hover:border-emerald-300"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink-900">{post.title}</span>
                      <span className="mt-1 block truncate text-xs text-ink-500">
                        /blog/{post.slug} · {post.readingMinutes} min read · {formatNumber(post.viewCount)} views
                      </span>
                    </span>
                    <StatusBadge status={post.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Activity ── */}
        <section>
          <h2 className="mb-4 text-sm font-bold text-ink-900">Recent activity</h2>
          <div className="rounded-xl border border-ink-200 bg-white p-4 shadow-card">
            {loading ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            ) : activity.length === 0 ? (
              <p className="py-6 text-center text-sm text-ink-500">Nothing yet.</p>
            ) : (
              <ol className="space-y-3.5">
                {activity.map((entry) => (
                  <li key={entry.id} className="text-xs leading-relaxed">
                    <span className="font-medium text-ink-800">{entry.actorEmail ?? 'Someone'}</span>{' '}
                    <span className="text-ink-500">{ACTION_LABELS[entry.action] ?? entry.action}</span>
                    {entry.summary && <span className="text-ink-800"> “{entry.summary}”</span>}
                    <span className="mt-0.5 block text-ink-400" title={formatDateTime(entry.createdAt)}>
                      {friendlyDate(entry.createdAt)}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-ink-200 bg-white p-4 text-xs leading-relaxed text-ink-500 shadow-card">
            <p className="font-semibold text-ink-800">
              <Archive className="mr-1.5 inline h-3.5 w-3.5" />
              Archiving vs deleting
            </p>
            <p className="mt-1.5">
              Archiving hides an article from readers but keeps its URL and its history. Deleting is permanent and
              breaks any link already pointing at it.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}
