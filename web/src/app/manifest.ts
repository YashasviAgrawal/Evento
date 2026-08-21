import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tixit — Find Your Moment',
    short_name: 'Tixit',
    description:
      'Discover and book movies, events, concerts, comedy shows and sports with instant digital QR tickets.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0f172a',
    theme_color: '#e11d48',
    icons: [
      { src: '/icon', sizes: '32x32', type: 'image/png' },
      { src: '/apple-icon', sizes: '180x180', type: 'image/png' },
    ],
  };
}
