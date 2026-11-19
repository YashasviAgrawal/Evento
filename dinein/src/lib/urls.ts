/** Where the events app lives — for the app switcher and the shared account pages. */
export const EVENTS_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';
export const DINEIN_URL = process.env.NEXT_PUBLIC_DINEIN_URL ?? 'http://localhost:3001';

/** Only same-app paths are honoured after sign-in, never an absolute URL. */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return fallback;
  return next;
}

export function directionsUrl(lat: number, lng: number, name: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=${encodeURIComponent(name)}`;
}
