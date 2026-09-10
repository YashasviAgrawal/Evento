'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ExternalLink, Eye, Newspaper, Plus, Search, Trash2, X } from 'lucide-react';
import { api, ApiError, type PageMeta } from '@/lib/api';
import type { AdminBlogPost, BlogCategory, BlogFaqItem } from '@/lib/types';
import { PageHeader } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, Field, Input, Select, Skeleton, StatusBadge, Textarea } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { formatDateTime } from '@/lib/format';

const STATUS_TABS = [
  { key: '', label: 'All' },
  { key: 'published', label: 'Published' },
  { key: 'draft', label: 'Drafts' },
  { key: 'archived', label: 'Archived' },
];

/** Everything the editor form holds, as strings, before it is sent to the API. */
interface FormState {
  title: string;
  slug: string;
  excerpt: string;
  content: string;
  categoryId: string;
  coverImageUrl: string;
  coverImageAlt: string;
  authorName: string;
  status: 'draft' | 'published' | 'archived';
  isFeatured: boolean;
  tags: string;
  metaTitle: string;
  metaDescription: string;
  focusKeyword: string;
  faq: BlogFaqItem[];
}

const EMPTY_FORM: FormState = {
  title: '',
  slug: '',
  excerpt: '',
  content: '',
  categoryId: '',
  coverImageUrl: '',
  coverImageAlt: '',
  authorName: '',
  status: 'draft',
  isFeatured: false,
  tags: '',
  metaTitle: '',
  metaDescription: '',
  focusKeyword: '',
  faq: [],
};

/** Same rule the server applies, so the previewed URL matches the saved one. */
function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export default function AdminBlogPage() {
  const toast = useToast();

  const [posts, setPosts] = useState<AdminBlogPost[]>([]);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [meta, setMeta] = useState<PageMeta | null>(null);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [loading, setLoading] = useState(true);

  const [editing, setEditing] = useState<AdminBlogPost | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = creating || editing !== null;

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
      const response = await api.get<AdminBlogPost[]>('/admin/blog', {
        query: { q: debounced || undefined, status: status || undefined, page, limit: 20 },
      });
      setPosts(response.data);
      setMeta(response.meta ?? null);
    } catch {
      setPosts([]);
    } finally {
      setLoading(false);
    }
  }, [debounced, status, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    api
      .get<BlogCategory[]>('/admin/blog/categories')
      .then((response) => setCategories(response.data))
      .catch(() => setCategories([]));
  }, []);

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditing(null);
    setCreating(true);
    setError(null);
  }

  function startEdit(post: AdminBlogPost) {
    setForm({
      title: post.title,
      slug: post.slug,
      excerpt: post.excerpt,
      content: post.content,
      categoryId: post.categoryId ?? '',
      coverImageUrl: post.coverImageUrl ?? '',
      coverImageAlt: post.coverImageAlt ?? '',
      authorName: post.authorName,
      status: post.status,
      isFeatured: post.isFeatured,
      tags: post.tags.join(', '),
      metaTitle: post.metaTitle ?? '',
      metaDescription: post.metaDescription ?? '',
      focusKeyword: post.focusKeyword ?? '',
      faq: post.faq,
    });
    setCreating(false);
    setEditing(post);
    setError(null);
  }

  function close() {
    setCreating(false);
    setEditing(null);
    setError(null);
  }

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save() {
    if (form.title.trim().length < 3) {
      setError('Give the article a title.');
      return;
    }

    // Empty strings are meaningfully different from "unset" for the nullable
    // SEO columns, and the API rejects "" where it expects a URL — so blanks
    // are sent as null rather than as empty strings.
    const blank = (value: string) => (value.trim() === '' ? null : value.trim());

    const payload = {
      title: form.title.trim(),
      slug: blank(form.slug) ?? slugify(form.title),
      excerpt: form.excerpt.trim(),
      content: form.content,
      categoryId: blank(form.categoryId),
      coverImageUrl: blank(form.coverImageUrl),
      coverImageAlt: blank(form.coverImageAlt),
      authorName: blank(form.authorName) ?? undefined,
      status: form.status,
      isFeatured: form.isFeatured,
      tags: form.tags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      metaTitle: blank(form.metaTitle),
      metaDescription: blank(form.metaDescription),
      focusKeyword: blank(form.focusKeyword),
      faq: form.faq.filter((item) => item.question.trim() && item.answer.trim()),
    };

    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await api.patch(`/admin/blog/${editing.id}`, payload);
        toast.success('Article saved');
      } else {
        await api.post('/admin/blog', payload);
        toast.success(payload.status === 'published' ? 'Article published' : 'Draft created');
      }
      close();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? [err.message, ...err.fieldMessages].join(' · ') : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  async function remove(post: AdminBlogPost) {
    if (!window.confirm(`Delete "${post.title}"? This cannot be undone.`)) return;
    try {
      await api.delete(`/admin/blog/${post.id}`);
      toast.success('Article deleted');
      await load();
    } catch (err) {
      toast.error('Could not delete', err instanceof ApiError ? err.message : undefined);
    }
  }

  return (
    <>
      <PageHeader
        title="Blog"
        description="Write and publish articles. Published posts appear at /blog and in the sitemap within ten minutes."
        actions={
          <Button onClick={startCreate}>
            <Plus className="h-4 w-4" />
            New article
          </Button>
        }
      />

      {open ? (
        <Editor
          form={form}
          set={set}
          categories={categories}
          editing={editing}
          saving={saving}
          error={error}
          onCancel={close}
          onSave={save}
        />
      ) : (
        <>
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
              {Array.from({ length: 5 }).map((_, index) => (
                <Skeleton key={index} className="h-20 w-full" />
              ))}
            </div>
          ) : posts.length === 0 ? (
            <EmptyState
              icon={<Newspaper className="h-8 w-8" />}
              title="No articles yet"
              description="Articles are how the site ranks for searches that have nothing to do with a specific event."
              action={
                <Button onClick={startCreate}>
                  <Plus className="h-4 w-4" />
                  Write the first one
                </Button>
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
                    <button
                      onClick={() => startEdit(post)}
                      className="mt-2 block text-left text-sm font-semibold text-ink-900 hover:text-brand-700"
                    >
                      {post.title}
                    </button>
                    <p className="mt-1 truncate text-xs text-ink-500">
                      /blog/{post.slug} · {post.readingMinutes} min read · {post.viewCount} views
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
                        aria-label="View article"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    )}
                    <Button size="sm" variant="outline" onClick={() => startEdit(post)}>
                      Edit
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => remove(post)}
                      aria-label="Delete article"
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
                Page {meta.page} of {meta.totalPages} · {meta.total} articles
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
      )}
    </>
  );
}

/* ─────────────────────────── editor ─────────────────────────── */

function Editor({
  form,
  set,
  categories,
  editing,
  saving,
  error,
  onCancel,
  onSave,
}: {
  form: FormState;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  categories: BlogCategory[];
  editing: AdminBlogPost | null;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: () => void;
}) {
  const slugPreview = form.slug.trim() || slugify(form.title) || 'untitled';

  // Live counts against the lengths Google actually renders. Over the limit is
  // not an error — it just gets truncated in the result — so this warns rather
  // than blocks.
  const titleLength = (form.metaTitle || form.title).length;
  const descriptionLength = (form.metaDescription || form.excerpt).length;

  const wordCount = useMemo(() => form.content.split(/\s+/).filter(Boolean).length, [form.content]);

  function updateFaq(index: number, patch: Partial<BlogFaqItem>) {
    set(
      'faq',
      form.faq.map((item, position) => (position === index ? { ...item, ...patch } : item)),
    );
  }

  return (
    <div className="space-y-6">
      {error && <Alert tone="error">{error}</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* ── Content ── */}
        <div className="space-y-5 rounded-xl border border-ink-200 bg-white p-5 shadow-card">
          <Field label="Title" required hint={`Appears as the H1. /blog/${slugPreview}`}>
            <Input
              value={form.title}
              onChange={(event) => set('title', event.target.value)}
              placeholder="How to Price Event Tickets"
            />
          </Field>

          <Field
            label="URL slug"
            hint="Derived from the title when left blank. Changing it on a published post breaks existing links."
          >
            <Input
              value={form.slug}
              onChange={(event) => set('slug', event.target.value)}
              placeholder={slugify(form.title) || 'how-to-price-event-tickets'}
            />
          </Field>

          <Field
            label="Excerpt"
            hint="The standfirst under the headline, and the fallback meta description. Two sentences."
          >
            <Textarea
              value={form.excerpt}
              onChange={(event) => set('excerpt', event.target.value)}
              rows={3}
              maxLength={500}
            />
          </Field>

          <Field label="Body" hint={`Markdown. ${wordCount} words · about ${Math.max(1, Math.ceil(wordCount / 200))} min read.`}>
            <Textarea
              value={form.content}
              onChange={(event) => set('content', event.target.value)}
              rows={26}
              className="font-mono text-[13px] leading-relaxed"
              placeholder={'## A section heading\n\nProse, **bold**, [links](/events) and lists.\n\n- point one\n- point two'}
            />
          </Field>
        </div>

        {/* ── Settings ── */}
        <div className="space-y-6">
          <div className="space-y-4 rounded-xl border border-ink-200 bg-white p-5 shadow-card">
            <h2 className="text-sm font-bold text-ink-900">Publishing</h2>

            <Field label="Status">
              <Select
                value={form.status}
                onChange={(event) => set('status', event.target.value as FormState['status'])}
              >
                <option value="draft">Draft — not visible</option>
                <option value="published">Published — live at /blog</option>
                <option value="archived">Archived — hidden</option>
              </Select>
            </Field>

            <Field label="Category">
              <Select value={form.categoryId} onChange={(event) => set('categoryId', event.target.value)}>
                <option value="">No category</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Author">
              <Input
                value={form.authorName}
                onChange={(event) => set('authorName', event.target.value)}
                placeholder="Tixit Editorial"
              />
            </Field>

            <label className="flex cursor-pointer items-center gap-2.5 text-sm text-ink-700">
              <input
                type="checkbox"
                checked={form.isFeatured}
                onChange={(event) => set('isFeatured', event.target.checked)}
                className="h-4 w-4 rounded border-ink-300 text-brand-600 focus:ring-brand-500"
              />
              Feature at the top of /blog
            </label>
          </div>

          <div className="space-y-4 rounded-xl border border-ink-200 bg-white p-5 shadow-card">
            <h2 className="text-sm font-bold text-ink-900">Cover image</h2>
            <Field label="Image URL" hint="1200×630 or wider — this is what shows when the link is shared.">
              <Input
                value={form.coverImageUrl}
                onChange={(event) => set('coverImageUrl', event.target.value)}
                placeholder="https://…"
              />
            </Field>
            <Field label="Alt text" hint="Describe the image. Required for accessibility, read by image search.">
              <Input
                value={form.coverImageAlt}
                onChange={(event) => set('coverImageAlt', event.target.value)}
              />
            </Field>
          </div>

          <div className="space-y-4 rounded-xl border border-ink-200 bg-white p-5 shadow-card">
            <h2 className="text-sm font-bold text-ink-900">Search appearance</h2>

            <Field
              label="Meta title"
              hint={`${titleLength} characters. Google shows about 60 — over that is truncated.`}
            >
              <Input
                value={form.metaTitle}
                onChange={(event) => set('metaTitle', event.target.value)}
                placeholder={form.title || 'Falls back to the title'}
              />
            </Field>

            <Field
              label="Meta description"
              hint={`${descriptionLength} characters. Aim for 140–160; over that is truncated.`}
            >
              <Textarea
                value={form.metaDescription}
                onChange={(event) => set('metaDescription', event.target.value)}
                rows={3}
                placeholder="Falls back to the excerpt"
              />
            </Field>

            <Field label="Focus keyword" hint="The one search this article is written to win. For your reference.">
              <Input
                value={form.focusKeyword}
                onChange={(event) => set('focusKeyword', event.target.value)}
                placeholder="how to price event tickets"
              />
            </Field>

            <Field label="Tags" hint="Comma separated.">
              <Input
                value={form.tags}
                onChange={(event) => set('tags', event.target.value)}
                placeholder="jaipur, live music, venues"
              />
            </Field>
          </div>
        </div>
      </div>

      {/* ── FAQ ── */}
      <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-bold text-ink-900">Frequently asked questions</h2>
            <p className="mt-1 text-xs text-ink-500">
              Shown at the end of the article and published as FAQ structured data, which is what can earn
              expandable answers in a search result. Write real questions people ask — markup describing
              content that is not on the page is penalised, not rewarded.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => set('faq', [...form.faq, { question: '', answer: '' }])}
          >
            <Plus className="h-4 w-4" />
            Add question
          </Button>
        </div>

        {form.faq.length > 0 && (
          <div className="mt-4 space-y-4">
            {form.faq.map((item, index) => (
              <div key={index} className="rounded-lg border border-ink-200 p-4">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1 space-y-3">
                    <Input
                      value={item.question}
                      onChange={(event) => updateFaq(index, { question: event.target.value })}
                      placeholder="How much do live music tickets cost in Jaipur?"
                    />
                    <Textarea
                      value={item.answer}
                      onChange={(event) => updateFaq(index, { answer: event.target.value })}
                      rows={3}
                      placeholder="A complete, self-contained answer in two or three sentences."
                    />
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove question"
                    onClick={() => set('faq', form.faq.filter((_, position) => position !== index))}
                    className="text-ink-400 hover:text-rose-600"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-ink-500">
          {editing?.status === 'published' && (
            <a
              href={`/blog/${editing.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 hover:text-ink-800"
            >
              <Eye className="h-3.5 w-3.5" />
              View live article
            </a>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={onCancel} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={onSave} loading={saving}>
            {editing ? 'Save changes' : form.status === 'published' ? 'Publish' : 'Create draft'}
          </Button>
        </div>
      </div>
    </div>
  );
}
