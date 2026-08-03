import type { APIRoute } from "astro";

/*
 * Nothing here is for crawlers
 *
 * No `Sitemap:` line: advertising a map of pages while disallowing all of them
 * contradicts itself. robots.txt only asks a crawler not to fetch, so `noindex` on the
 * pages themselves is the other half and both are needed
 */
export const getRobotsTxt = () => `User-agent: *
Disallow: /
`;

export const GET: APIRoute = () => new Response(getRobotsTxt());
