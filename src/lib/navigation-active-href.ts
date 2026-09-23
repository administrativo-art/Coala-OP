/** Match the most specific visible destination, including contextual query links. */
export function navigationActiveHref(hrefs: string[], pathname: string, search: string): string | null {
  const current = new URLSearchParams(search);
  const matches = hrefs.filter(href => href.startsWith("/")).map(href => {
    const destination = new URL(href, "https://navigation.local");
    const path = destination.pathname;
    const pathMatches = pathname === path || (path !== "/dashboard" && pathname.startsWith(`${path}/`));
    const queryMatches = [...destination.searchParams].every(([key, value]) => current.get(key) === value);
    return { href, pathMatches, queryMatches, length: path.length, specificity: destination.searchParams.size };
  }).filter(item => item.pathMatches && item.queryMatches)
    .sort((a, b) => b.length - a.length || b.specificity - a.specificity);
  return matches[0]?.href ?? null;
}
