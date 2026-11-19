/** Server-only: reads request cookies (next/headers). */
import { cookies } from 'next/headers';
import { CITY_COOKIE, DEFAULT_CITY, validCity } from './city';

/** The city to show: an explicit ?city= wins, then the remembered choice. */
export async function currentCity(explicit?: string | string[]): Promise<string> {
  const fromQuery = validCity(typeof explicit === 'string' ? explicit : null);
  if (fromQuery) return fromQuery;
  return validCity((await cookies()).get(CITY_COOKIE)?.value) ?? DEFAULT_CITY;
}
