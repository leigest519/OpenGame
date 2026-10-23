import type { MetadataRoute } from 'next';
import { appOrigin } from '@/server/config';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${appOrigin}/marketplace`, changeFrequency: 'daily', priority: 1 },
  ];
}
