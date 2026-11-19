/**
 * Tixit Dine-in, as seen from the events app: where it lives and the slice
 * of its API the cross-sell surfaces need. One account, so every link lands
 * signed in.
 */
export const DINEIN_URL = process.env.NEXT_PUBLIC_DINEIN_URL ?? 'http://localhost:3001';

export interface DineinCard {
  id: string;
  slug: string;
  name: string;
  locality: string;
  cuisines: string[];
  costForTwoPaise: number;
  coverUrl: string | null;
  rating: number;
  openNow: boolean;
  distanceKm: number | null;
  bestOffer: { label: string } | null;
}

export interface DineinHome {
  city: { name: string; slug: string };
  topRated: DineinCard[];
  bestOffers: DineinCard[];
}

export const dineinUrl = (path: string) => `${DINEIN_URL}${path}`;
