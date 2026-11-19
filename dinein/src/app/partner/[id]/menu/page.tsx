'use client';

import { use, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, BookOpen, Camera, Pencil, Plus, Trash2, X } from 'lucide-react';
import { ApiError, api, uploadForm } from '@tixit/session';
import { useToast } from '@tixit/ui';
import type { Diet, MenuBadge, MenuItem, MenuSection } from '@/lib/types';
import { cn, rupees } from '@/lib/format';
import { PageHeading } from '@/components/partner/partner-shell';
import { Sheet } from '@/components/ui/sheet';
import { Toggle } from '@/components/ui/controls';
import { EmptyState, Skeleton, Spinner } from '@/components/ui/feedback';
import { Photo } from '@/components/ui/photo';
import { BADGE_LABEL, DIET_LABEL, DietMark } from '@/components/menu/diet-mark';

interface ItemDraft {
  sectionId: string;
  name: string;
  description: string;
  price: string;
  diet: Diet;
  spiceLevel: number;
  badges: MenuBadge[];
  imageUrl: string | null;
  isAvailable: boolean;
}

const DIETS: Diet[] = ['veg', 'vegan', 'egg', 'non_veg'];
const BADGES = Object.keys(BADGE_LABEL) as MenuBadge[];

function toDraft(item: MenuItem): ItemDraft {
  return {
    sectionId: item.sectionId,
    name: item.name,
    description: item.description ?? '',
    price: String(item.pricePaise / 100),
    diet: item.diet,
    spiceLevel: item.spiceLevel,
    badges: item.badges,
    imageUrl: item.imageUrl,
    isAvailable: item.isAvailable,
  };
}

function errorText(err: unknown) {
  return err instanceof ApiError ? (err.fieldMessages[0] ?? err.message) : 'Something went wrong';
}

/**
 * The menu diners read on the restaurant page. Built for a manager on a phone
 * between services: mark a dish sold out in one tap, add one in under a
 * minute, nudge the order with arrows rather than a fiddly drag.
 */
export default function PartnerMenuPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = ['partner-menu', id];
  const [section, setSection] = useState<{ id: string | null; name: string; description: string } | null>(null);
  const [item, setItem] = useState<{ id: string | null; draft: ItemDraft } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const menu = useQuery({ queryKey: key, queryFn: async () => (await api.get<MenuSection[]>(`/partner/r/${id}/menu`)).data });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: key });
  const sections = menu.data ?? [];

  const saveSection = useMutation({
    mutationFn: async () => {
      if (!section) return;
      const body = { name: section.name, description: section.description || null };
      if (section.id) await api.put(`/partner/r/${id}/menu/sections/${section.id}`, body);
      else await api.post(`/partner/r/${id}/menu/sections`, body);
    },
    onSuccess: () => {
      setSection(null);
      refresh();
    },
    onError: (err) => setError(errorText(err)),
  });

  const removeSection = useMutation({
    mutationFn: async (target: MenuSection) => api.delete(`/partner/r/${id}/menu/sections/${target.id}`),
    onSuccess: () => {
      toast.success('Section removed');
      refresh();
    },
  });

  const saveItem = useMutation({
    mutationFn: async () => {
      if (!item) return;
      const body = {
        ...item.draft,
        description: item.draft.description || null,
        price: Number(item.draft.price || 0),
      };
      if (item.id) await api.patch(`/partner/r/${id}/menu/items/${item.id}`, body);
      else await api.post(`/partner/r/${id}/menu/items`, body);
    },
    onSuccess: () => {
      toast.success(item?.id ? 'Dish updated' : 'Dish added', 'Diners see it on your page right away.');
      setItem(null);
      refresh();
    },
    onError: (err) => setError(errorText(err)),
  });

  // Optimistic: a sold-out tap should feel instant at a busy pass.
  const toggleItem = useMutation({
    mutationFn: async (target: MenuItem) => api.patch(`/partner/r/${id}/menu/items/${target.id}`, { isAvailable: !target.isAvailable }),
    onMutate: async (target) => {
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<MenuSection[]>(key, (old) =>
        old?.map((s) => ({ ...s, items: s.items.map((i) => (i.id === target.id ? { ...i, isAvailable: !i.isAvailable } : i)) })),
      );
    },
    onError: () => toast.error('Could not update that dish'),
    onSettled: refresh,
  });

  const removeItem = useMutation({
    mutationFn: async (target: MenuItem) => api.delete(`/partner/r/${id}/menu/items/${target.id}`),
    onSuccess: refresh,
  });

  const reorder = useMutation({
    mutationFn: async (body: { sectionId?: string; ids: string[] }) => api.post(`/partner/r/${id}/menu/order`, body),
    onError: (err) => toast.error('Could not reorder', errorText(err)),
    onSettled: refresh,
  });

  function move<T extends { id: string }>(list: T[], index: number, step: number, sectionId?: string) {
    const target = index + step;
    if (target < 0 || target >= list.length) return;
    const ids = list.map((entry) => entry.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    reorder.mutate({ sectionId, ids });
  }

  const newItem = (sectionId: string) => {
    setError(null);
    setItem({
      id: null,
      draft: { sectionId, name: '', description: '', price: '', diet: 'veg', spiceLevel: 0, badges: [], imageUrl: null, isAvailable: true },
    });
  };
  const draft = item?.draft;
  const setDraft = (patch: Partial<ItemDraft>) => setItem((current) => (current ? { ...current, draft: { ...current.draft, ...patch } } : current));
  const dishCount = sections.reduce((sum, s) => sum + s.items.length, 0);
  const soldOut = sections.reduce((sum, s) => sum + s.items.filter((i) => !i.isAvailable).length, 0);

  return (
    <>
      <PageHeading
        title="Menu"
        subtitle={dishCount ? `${dishCount} dishes${soldOut ? ` · ${soldOut} sold out today` : ''}` : 'What diners read before they book.'}
        action={
          <button
            onClick={() => {
              setError(null);
              setSection({ id: null, name: '', description: '' });
            }}
            className="press inline-flex h-10 items-center gap-1.5 rounded-xl bg-brand-600 px-4 text-sm font-bold text-white shadow-glow"
          >
            <Plus className="h-4 w-4" /> Section
          </button>
        }
      />
      <div className="space-y-4 px-4 pb-10 pt-5 sm:px-8">
        {menu.isLoading ? (
          <Skeleton className="h-60 rounded-3xl" />
        ) : sections.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title="No menu yet"
            body="Start with a section like “Starters”, then add dishes. Restaurants with a menu get more bookings."
          />
        ) : (
          sections.map((s, sectionIndex) => (
            <section key={s.id} className="overflow-hidden rounded-3xl bg-white ring-1 ring-ink-200">
              <header className="flex items-center gap-2 border-b border-ink-100 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-extrabold">{s.name}</h2>
                  {s.description && <p className="truncate text-xs text-ink-500">{s.description}</p>}
                </div>
                <IconButton label="Move section up" onClick={() => move(sections, sectionIndex, -1)} disabled={sectionIndex === 0}>
                  <ArrowUp className="h-4 w-4" />
                </IconButton>
                <IconButton label="Move section down" onClick={() => move(sections, sectionIndex, 1)} disabled={sectionIndex === sections.length - 1}>
                  <ArrowDown className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label="Rename section"
                  onClick={() => {
                    setError(null);
                    setSection({ id: s.id, name: s.name, description: s.description ?? '' });
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </IconButton>
                <IconButton
                  label="Delete section"
                  danger
                  onClick={() => {
                    if (s.items.length === 0 || window.confirm(`Delete “${s.name}” and its ${s.items.length} dishes?`)) removeSection.mutate(s);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </IconButton>
              </header>
              <ul className="divide-y divide-ink-100">
                {s.items.map((dish, itemIndex) => (
                  <li key={dish.id} className="flex items-center gap-3 px-4 py-3">
                    <Photo src={dish.imageUrl} alt="" sizes="48px" className="h-12 w-12 shrink-0 rounded-xl" />
                    <div className={cn('min-w-0 flex-1', !dish.isAvailable && 'opacity-50')}>
                      <p className="flex items-center gap-1.5 truncate text-sm font-bold">
                        <DietMark diet={dish.diet} /> {dish.name}
                      </p>
                      <p className="num text-xs text-ink-500">
                        {rupees(dish.pricePaise)}
                        {dish.badges.length > 0 && ` · ${dish.badges.map((b) => BADGE_LABEL[b]).join(', ')}`}
                      </p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={dish.isAvailable}
                      aria-label={`${dish.name} in stock`}
                      onClick={() => toggleItem.mutate(dish)}
                      className={cn(
                        'press hidden h-8 shrink-0 rounded-full px-3 text-xs font-bold ring-1 ring-inset sm:block',
                        dish.isAvailable ? 'bg-save-50 text-save-700 ring-save-200' : 'bg-ink-100 text-ink-500 ring-ink-200',
                      )}
                    >
                      {dish.isAvailable ? 'In stock' : 'Sold out'}
                    </button>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={dish.isAvailable}
                      aria-label={`${dish.name} in stock`}
                      onClick={() => toggleItem.mutate(dish)}
                      className={cn('relative h-6 w-10 shrink-0 rounded-full transition sm:hidden', dish.isAvailable ? 'bg-save-500' : 'bg-ink-300')}
                    >
                      <span className={cn('absolute top-1 h-4 w-4 rounded-full bg-white transition-all', dish.isAvailable ? 'left-5' : 'left-1')} />
                    </button>
                    <div className="hidden items-center sm:flex">
                      <IconButton label="Move dish up" onClick={() => move(s.items, itemIndex, -1, s.id)} disabled={itemIndex === 0}>
                        <ArrowUp className="h-4 w-4" />
                      </IconButton>
                      <IconButton label="Move dish down" onClick={() => move(s.items, itemIndex, 1, s.id)} disabled={itemIndex === s.items.length - 1}>
                        <ArrowDown className="h-4 w-4" />
                      </IconButton>
                    </div>
                    <IconButton
                      label={`Edit ${dish.name}`}
                      onClick={() => {
                        setError(null);
                        setItem({ id: dish.id, draft: toDraft(dish) });
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                    </IconButton>
                  </li>
                ))}
              </ul>
              <button
                onClick={() => newItem(s.id)}
                className="flex w-full items-center justify-center gap-1.5 border-t border-ink-100 py-3 text-sm font-bold text-brand-700 hover:bg-brand-50"
              >
                <Plus className="h-4 w-4" /> Add dish
              </button>
            </section>
          ))
        )}
      </div>

      <Sheet
        open={Boolean(section)}
        onClose={() => setSection(null)}
        title={section?.id ? 'Rename section' : 'New section'}
        footer={
          <button
            onClick={() => saveSection.mutate()}
            disabled={saveSection.isPending || !section?.name.trim()}
            className="press mb-1 h-12 w-full rounded-2xl bg-ink-900 font-bold text-white disabled:opacity-60"
          >
            {saveSection.isPending ? 'Saving…' : 'Save section'}
          </button>
        }
      >
        {section && (
          <div className="space-y-4 pt-1">
            <div>
              <label className="label" htmlFor="section-name">Name</label>
              <input id="section-name" className="input" value={section.name} maxLength={60} onChange={(e) => setSection({ ...section, name: e.target.value })} placeholder="e.g. Starters" />
            </div>
            <div>
              <label className="label" htmlFor="section-desc">Note (optional)</label>
              <input id="section-desc" className="input" value={section.description} maxLength={200} onChange={(e) => setSection({ ...section, description: e.target.value })} placeholder="e.g. Served till 11 pm" />
            </div>
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
          </div>
        )}
      </Sheet>

      <Sheet
        open={Boolean(item)}
        onClose={() => setItem(null)}
        title={item?.id ? 'Edit dish' : 'New dish'}
        footer={
          <div className="mb-1 flex gap-2">
            {item?.id && (
              <button
                onClick={() => {
                  const target = sections.flatMap((s) => s.items).find((i) => i.id === item.id);
                  if (target && window.confirm(`Delete “${target.name}”?`)) {
                    removeItem.mutate(target);
                    setItem(null);
                  }
                }}
                className="press grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-rose-600 ring-1 ring-inset ring-rose-200"
                aria-label="Delete dish"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            )}
            <button
              onClick={() => saveItem.mutate()}
              disabled={saveItem.isPending || !draft?.name.trim() || draft.price === ''}
              className="press h-12 flex-1 rounded-2xl bg-ink-900 font-bold text-white disabled:opacity-60"
            >
              {saveItem.isPending ? 'Saving…' : item?.id ? 'Save dish' : 'Add dish'}
            </button>
          </div>
        }
      >
        {draft && (
          <div className="space-y-4 pt-1">
            <DishPhoto restaurantId={id} url={draft.imageUrl} onChange={(imageUrl) => setDraft({ imageUrl })} />
            <div>
              <label className="label" htmlFor="dish-name">Dish name</label>
              <input id="dish-name" className="input" value={draft.name} maxLength={80} onChange={(e) => setDraft({ name: e.target.value })} placeholder="e.g. Laal maas" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label" htmlFor="dish-price">Price (₹)</label>
                <input id="dish-price" className="input" inputMode="decimal" value={draft.price} onChange={(e) => setDraft({ price: e.target.value.replace(/[^\d.]/g, '') })} />
              </div>
              <div>
                <label className="label" htmlFor="dish-section">Section</label>
                <select id="dish-section" className="input" value={draft.sectionId} onChange={(e) => setDraft({ sectionId: e.target.value })}>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="label" htmlFor="dish-desc">Description</label>
              <textarea id="dish-desc" rows={2} className="input resize-none" value={draft.description} maxLength={300} onChange={(e) => setDraft({ description: e.target.value })} placeholder="What's in it, how it's cooked" />
            </div>
            <div>
              <p className="label">Food type</p>
              <div className="grid grid-cols-4 gap-2">
                {DIETS.map((diet) => (
                  <button
                    key={diet}
                    type="button"
                    onClick={() => setDraft({ diet })}
                    aria-pressed={draft.diet === diet}
                    className={cn('flex h-10 items-center justify-center gap-1.5 rounded-xl text-xs font-bold ring-1 ring-inset', draft.diet === diet ? 'bg-ink-900 text-white ring-ink-900' : 'ring-ink-200')}
                  >
                    <DietMark diet={diet} /> {DIET_LABEL[diet]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="label">Spice</p>
              <div className="grid grid-cols-4 gap-2">
                {['None', 'Mild', 'Medium', 'Hot'].map((label, level) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setDraft({ spiceLevel: level })}
                    aria-pressed={draft.spiceLevel === level}
                    className={cn('h-10 rounded-xl text-xs font-bold ring-1 ring-inset', draft.spiceLevel === level ? 'bg-brand-600 text-white ring-brand-600' : 'ring-ink-200')}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="label">Highlight</p>
              <div className="flex flex-wrap gap-2">
                {BADGES.map((badge) => {
                  const on = draft.badges.includes(badge);
                  return (
                    <button
                      key={badge}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setDraft({ badges: on ? draft.badges.filter((b) => b !== badge) : [...draft.badges, badge] })}
                      className={cn('rounded-full px-3 py-1.5 text-xs font-bold ring-1 ring-inset', on ? 'bg-brand-50 text-brand-700 ring-brand-300' : 'ring-ink-200 text-ink-600')}
                    >
                      {BADGE_LABEL[badge]}
                    </button>
                  );
                })}
              </div>
            </div>
            <Toggle checked={draft.isAvailable} onChange={(isAvailable) => setDraft({ isAvailable })} label="In stock today" description="Sold-out dishes stay on the menu, marked." />
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
          </div>
        )}
      </Sheet>
    </>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={cn(
        'press grid h-9 w-9 shrink-0 place-items-center rounded-xl text-ink-500 disabled:opacity-30',
        danger ? 'hover:bg-rose-50 hover:text-rose-600' : 'hover:bg-ink-100 hover:text-ink-900',
      )}
    >
      {children}
    </button>
  );
}

function DishPhoto({ restaurantId, url, onChange }: { restaurantId: string; url: string | null; onChange: (url: string | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [uploading, setUploading] = useState(false);

  async function upload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const stored = await uploadForm<{ url: string }>(`/partner/r/${restaurantId}/menu/photos`, form);
      onChange(stored.url);
    } catch (err) {
      toast.error('Could not upload the photo', errorText(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Photo src={url} alt="" sizes="80px" className="h-20 w-20 shrink-0 rounded-2xl">
        {uploading && (
          <span className="absolute inset-0 grid place-items-center bg-ink-900/40">
            <Spinner className="text-white" />
          </span>
        )}
      </Photo>
      <div className="flex flex-col items-start gap-1.5">
        <button type="button" onClick={() => input.current?.click()} className="press inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-bold ring-1 ring-inset ring-ink-200">
          <Camera className="h-3.5 w-3.5" /> {url ? 'Change photo' : 'Add photo'}
        </button>
        {url && (
          <button type="button" onClick={() => onChange(null)} className="inline-flex items-center gap-1 text-xs font-semibold text-ink-500 hover:text-rose-600">
            <X className="h-3 w-3" /> Remove
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
