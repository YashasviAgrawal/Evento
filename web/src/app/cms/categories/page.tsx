'use client';

import { useCallback, useEffect, useState } from 'react';
import { FolderTree, Plus, Trash2 } from 'lucide-react';
import { cmsApi, ApiError } from '@/lib/cms-api';
import type { BlogCategory } from '@/lib/types';
import { PageHeader } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { Alert, EmptyState, Field, Input, Skeleton, Textarea } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';

interface CategoryForm {
  name: string;
  slug: string;
  description: string;
  displayOrder: string;
}

const EMPTY_FORM: CategoryForm = { name: '', slug: '', description: '', displayOrder: '100' };

export default function CmsCategoriesPage() {
  const toast = useToast();

  const [categories, setCategories] = useState<BlogCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<CategoryForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await cmsApi.get<BlogCategory[]>('/categories');
      setCategories(data);
    } catch {
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startCreate() {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setCreating(true);
    setError(null);
  }

  function startEdit(category: BlogCategory) {
    setForm({
      name: category.name,
      slug: category.slug,
      description: category.description ?? '',
      displayOrder: String(category.displayOrder),
    });
    setCreating(false);
    setEditingId(category.id);
    setError(null);
  }

  function close() {
    setCreating(false);
    setEditingId(null);
    setError(null);
  }

  async function save() {
    if (form.name.trim().length < 2) {
      setError('Give the category a name.');
      return;
    }

    const payload = {
      name: form.name.trim(),
      // Left blank, the server derives it from the name.
      slug: form.slug.trim() || undefined,
      description: form.description.trim() || null,
      displayOrder: Number(form.displayOrder) || 100,
    };

    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await cmsApi.patch(`/categories/${editingId}`, payload);
        toast.success('Category saved');
      } else {
        await cmsApi.post('/categories', payload);
        toast.success('Category added');
      }
      close();
      await load();
    } catch (err) {
      setError(
        err instanceof ApiError ? [err.message, ...err.fieldMessages].join(' · ') : 'Could not save the category',
      );
    } finally {
      setSaving(false);
    }
  }

  async function remove(category: BlogCategory) {
    const warning =
      category.postCount > 0
        ? `Delete “${category.name}”? Its ${category.postCount} published article${
            category.postCount === 1 ? '' : 's'
          } will stay live but become uncategorised.`
        : `Delete “${category.name}”?`;
    if (!window.confirm(warning)) return;

    try {
      await cmsApi.delete(`/categories/${category.id}`);
      toast.success('Category deleted');
      await load();
    } catch (err) {
      toast.error('Could not delete', err instanceof ApiError ? err.message : undefined);
    }
  }

  const open = creating || editingId !== null;

  return (
    <>
      <PageHeader
        title="Categories"
        description="How articles are grouped at /blog. Each one gets its own page at /blog/category/<slug>."
        actions={
          !open && (
            <Button onClick={startCreate}>
              <Plus className="h-4 w-4" />
              New category
            </Button>
          )
        }
      />

      {open && (
        <div className="mb-6 space-y-4 rounded-xl border border-ink-200 bg-white p-5 shadow-card">
          <h2 className="text-sm font-bold text-ink-900">{editingId ? 'Edit category' : 'New category'}</h2>

          {error && <Alert tone="error">{error}</Alert>}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required>
              <Input
                value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                placeholder="City Guides"
                autoFocus
              />
            </Field>
            <Field label="URL slug" hint="Derived from the name when left blank.">
              <Input
                value={form.slug}
                onChange={(event) => setForm((current) => ({ ...current, slug: event.target.value }))}
                placeholder="city-guides"
              />
            </Field>
          </div>

          <Field label="Description" hint="Shown at the top of the category page and used as its meta description.">
            <Textarea
              value={form.description}
              onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
              rows={2}
              maxLength={500}
            />
          </Field>

          <Field label="Display order" hint="Lower numbers appear first in the category navigation.">
            <Input
              type="number"
              min={0}
              max={9999}
              value={form.displayOrder}
              onChange={(event) => setForm((current) => ({ ...current, displayOrder: event.target.value }))}
              className="max-w-[140px]"
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={close} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={saving}>
              {editingId ? 'Save changes' : 'Add category'}
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-16 w-full" />
          ))}
        </div>
      ) : categories.length === 0 ? (
        <EmptyState
          icon={<FolderTree className="h-8 w-8" />}
          title="No categories yet"
          description="Categories group related articles and give each group its own landing page."
          action={
            <Button onClick={startCreate}>
              <Plus className="h-4 w-4" />
              Add a category
            </Button>
          }
        />
      ) : (
        <div className="space-y-3">
          {categories.map((category) => (
            <div
              key={category.id}
              className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-ink-200 bg-white p-4 shadow-card"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink-900">{category.name}</p>
                <p className="mt-1 text-xs text-ink-500">
                  /blog/category/{category.slug} · {category.postCount} published article
                  {category.postCount === 1 ? '' : 's'}
                </p>
                {category.description && (
                  <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-ink-500">{category.description}</p>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => startEdit(category)}>
                  Edit
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => void remove(category)}
                  aria-label={`Delete ${category.name}`}
                  className="text-rose-600 hover:bg-rose-50"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
