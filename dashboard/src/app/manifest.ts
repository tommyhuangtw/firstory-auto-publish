import type { MetadataRoute } from 'next';

// Web app manifest — makes the dashboard installable to the iPhone home screen,
// which is the prerequisite for iOS Web Push (iOS 16.4+ only delivers push to
// home-screen PWAs, not Safari tabs).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'AI懶人報 Dashboard',
    short_name: 'AI懶人報',
    description: 'AI懶人報 — Podcast Automation Dashboard',
    start_url: '/',
    display: 'standalone',
    background_color: '#09090b',
    theme_color: '#09090b',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
