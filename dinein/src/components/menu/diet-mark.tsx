import type { Diet, MenuBadge } from '@/lib/types';
import { cn } from '@/lib/format';

const DIET: Record<Diet, { label: string; ring: string; dot: string; shape: 'dot' | 'triangle' }> = {
  veg: { label: 'Vegetarian', ring: 'border-emerald-600', dot: 'bg-emerald-600', shape: 'dot' },
  vegan: { label: 'Vegan', ring: 'border-emerald-600', dot: 'bg-emerald-600', shape: 'dot' },
  egg: { label: 'Contains egg', ring: 'border-amber-500', dot: 'bg-amber-500', shape: 'dot' },
  non_veg: { label: 'Non-vegetarian', ring: 'border-red-700', dot: 'border-b-red-700', shape: 'triangle' },
};

/**
 * The FSSAI-style food mark diners in India read without thinking: a green
 * dot for veg, a brown-red triangle for non-veg — so shape, not only colour,
 * carries the meaning.
 */
export function DietMark({ diet, className }: { diet: Diet; className?: string }) {
  const style = DIET[diet];
  return (
    <span
      role="img"
      aria-label={style.label}
      title={style.label}
      className={cn('inline-grid h-3.5 w-3.5 shrink-0 place-items-center rounded-[3px] border-[1.5px] bg-white', style.ring, className)}
    >
      {style.shape === 'dot' ? (
        <span className={cn('h-1.5 w-1.5 rounded-full', style.dot)} />
      ) : (
        <span className={cn('h-0 w-0 border-x-[3.5px] border-b-[6px] border-x-transparent', style.dot)} />
      )}
    </span>
  );
}

export const BADGE_LABEL: Record<MenuBadge, string> = {
  bestseller: 'Bestseller',
  chef_special: "Chef's special",
  new: 'New',
  signature: 'Signature',
};

export const DIET_LABEL: Record<Diet, string> = {
  veg: 'Veg',
  vegan: 'Vegan',
  egg: 'Egg',
  non_veg: 'Non-veg',
};
