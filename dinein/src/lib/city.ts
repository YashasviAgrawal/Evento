/** The diner's city lives in a cookie so server-rendered pages can read it. */
export const CITY_COOKIE = 'tx_city';
export const DEFAULT_CITY = 'jaipur';
const SLUG = /^[a-z0-9-]{2,40}$/;

export function validCity(value: string | undefined | null): string | null {
  return value && SLUG.test(value) ? value : null;
}

/** Remember a city choice for a year (client side). */
export function rememberCity(slug: string): void {
  document.cookie = `${CITY_COOKIE}=${slug}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export interface CityOption {
  id: string;
  name: string;
  slug: string;
  state: string;
  restaurants: number;
}
