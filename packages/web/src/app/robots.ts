import type { MetadataRoute } from 'next';
import { appOrigin } from '@/server/config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/marketplace',
      disallow: [
        '/api/',
        '/projects/',
        '/play/',
        '/library',
        '/knowledge',
        '/evolution',
      ],
    },
    sitemap: `${appOrigin}/sitemap.xml`,
  };
}
