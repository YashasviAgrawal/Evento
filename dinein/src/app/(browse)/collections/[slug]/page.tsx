import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { fetchPublic } from '@tixit/session';
import type { CollectionPage } from '@/lib/types';
import { Photo } from '@/components/ui/photo';
import { RestaurantCard } from '@/components/restaurant/restaurant-card';

type Props = { params: Promise<{ slug: string }> };
const load = (slug: string) => fetchPublic<CollectionPage>(`/dining/collections/${slug}`, undefined, 300);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const collection = await load((await params).slug);
  return { title: collection?.title ?? 'Collection', description: collection?.subtitle ?? undefined };
}

export default async function CollectionRoute({ params }: Props) {
  const collection = await load((await params).slug);
  if (!collection) notFound();
  return (
    <>
      <Photo src={collection.coverUrl} alt="" priority className="h-64 sm:h-80">
        <div className="absolute inset-0 bg-gradient-to-t from-ink-950/90 via-ink-950/30 to-transparent" />
        <div className="container-page absolute inset-x-0 bottom-6 text-white">
          <p className="eyebrow text-brand-300">Collection · {collection.restaurants.length} places</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight sm:text-5xl">{collection.title}</h1>
          {collection.subtitle && <p className="mt-2 max-w-xl text-white/80">{collection.subtitle}</p>}
        </div>
      </Photo>
      <div className="container-page grid gap-4 py-8 sm:grid-cols-2 lg:grid-cols-3">
        {collection.restaurants.map((card, index) => (
          <RestaurantCard key={card.id} card={card} priority={index < 3} />
        ))}
      </div>
    </>
  );
}
