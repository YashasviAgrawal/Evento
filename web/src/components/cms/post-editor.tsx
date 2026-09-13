'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Eye, Plus, Trash2, X } from 'lucide-react';
import Link from 'next/link';
import { cmsApi, ApiError } from '@/lib/cms-api';
import type { AdminBlogPost, BlogCategory, BlogFaqItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input, Select, Textarea } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';

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

/** Mirrors the server's `slugify`, so the previewed URL is the saved one. */
function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function toForm(post: AdminBlogPost): FormState {
  return {
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
  };
}

/**
 * The article editor, shared by the "new" and "edit" routes.
 *
 * `post` being null means this is a new article; everything else about the two
 * modes is identical, so they are one component rather than two that drift.
 */
export function PostEditor({ post }: { post: AdminBlogPost | null }) {
  const router = useRouter();
  const toast = useToast();

  const [form, setForm] = useState<FormState>(post ? toForm(post) : EMPTY_FORM);
  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    cmsApi
      .get<BlogCategory[]>('/categories')
      .then((response) => setCategories(response.data))
      .catch(() => setCategories([]));
  }, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const slugPreview = form.slug.trim() || slugify(form.title) || 'untitled';
  const wordCount = useMemo(() => form.content.split(/\s+/).filter(Boolean).length, [form.content]);

  // Counted against what Google actually renders. Over the limit is a warning,
  // not an error — it simply gets truncated in the result.
  const titleLength = (form.metaTitle || form.title).length;
  const descriptionLength = (form.metaDescription || form.excerpt).length;

  async function save() {
    if (form.title.trim().length < 3) {
      setError('Give the article a title of at least three characters.');
      return;
    }

    // An empty string is not the same as "unset" for the nullable SEO columns,
    // and the API rejects "" where it expects a URL — so blanks go as null.
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
      if (post) {
        await cmsApi.patch(`/posts/${post.id}`, payload);
        toast.success('Article saved');
        router.refresh();
      } else {
        const { data } = await cmsApi.post<AdminBlogPost>('/posts', payload);
        toast.success(payload.status === 'published' ? 'Article published' : 'Draft created');
        // Swap the URL for the saved article's, so a reload reopens the edit
        // screen rather than a blank "new article" form.
        router.replace(`/cms/posts/${data.id}`);
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? [err.message, ...err.fieldMessages].join(' · ') : 'Could not save the article',
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!post) return;
    if (!window.confirm(`Delete “${post.title}”? This is permanent and breaks any link to /blog/${post.slug}.`)) {
      return;
    }
    try {
      await cmsApi.delete(`/posts/${post.id}`);
      toast.success('Article deleted');
      router.replace('/cms/posts');
    } catch (err) {
      toast.error('Could not delete', err instanceof ApiError ? err.message : undefined);
    }
  }

  function updateFaq(index: number, patch: Partial<BlogFaqItem>) {
    set(
      'faq',
      form.faq.map((item, position) => (position === index ? { ...item, ...patch } : item)),
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/cms/posts"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 transition hover:text-ink-800"
        >
          <ArrowLeft className="h-4 w-4" />
          All articles
        </Link>

        <div className="flex items-center gap-2">
          {post?.status === 'published' && (
            <a
              href={`/blog/${post.slug}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2 text-xs text-ink-500 transition hover:text-ink-800"
            >
              <Eye className="h-3.5 w-3.5" />
              View live
            </a>
          )}
          {post && (
            <Button variant="ghost" size="sm" onClick={() => void remove()} className="text-rose-600 hover:bg-rose-50">
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          )}
          <Button onClick={() => void save()} loading={saving}>
            {post ? 'Save changes' : form.status === 'published' ? 'Publish' : 'Create draft'}
          </Button>
        </div>
      </div>

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
            hint="Derived from the title when left blank. Changing it on a published article breaks existing links."
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

          <Field
            label="Body"
            hint={`Markdown. ${wordCount} words · about ${Math.max(1, Math.ceil(wordCount / 200))} min read.`}
          >
            <Textarea
              value={form.content}
              onChange={(event) => set('content', event.target.value)}
              rows={28}
              className="font-mono text-[13px] leading-relaxed"
              placeholder={
                '## A section heading\n\nProse, **bold**, [links](/events) and lists.\n\n- point one\n- point two'
              }
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
                <option value="archived">Archived — hidden, URL kept</option>
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

            <Field label="Byline" hint="The name readers see. Defaults to Tixit Editorial.">
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
                className="h-4 w-4 rounded border-ink-300 text-emerald-600 focus:ring-emerald-500"
              />
              Feature at the top of /blog
            </label>
          </div>

          <div className="space-y-4 rounded-xl border border-ink-200 bg-white p-5 shadow-card">
            <h2 className="text-sm font-bold text-ink-900">Cover image</h2>

            {form.coverImageUrl.trim() !== '' && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={form.coverImageUrl}
                alt={form.coverImageAlt || 'Cover preview'}
                className="aspect-[1200/630] w-full rounded-lg border border-ink-200 object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            )}

            <Field label="Image URL" hint="1200×630 or wider — this is what shows when the link is shared.">
              <Input
                value={form.coverImageUrl}
                onChange={(event) => set('coverImageUrl', event.target.value)}
                placeholder="https://…"
              />
            </Field>
            <Field label="Alt text" hint="Describe the image. Required for accessibility, read by image search.">
              <Input value={form.coverImageAlt} onChange={(event) => set('coverImageAlt', event.target.value)} />
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
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-ink-500">
              Shown at the end of the article and published as FAQ structured data, which is what can earn expandable
              answers in a search result. Write real questions people ask — markup describing content that is not on
              the page is penalised, not rewarded.
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
    </div>
  );
}
