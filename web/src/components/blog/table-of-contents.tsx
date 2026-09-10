import type { TocEntry } from '@/lib/markdown';

/**
 * In-page contents, built from the article's own H2s.
 *
 * Plain anchor links, rendered on the server: no JavaScript is needed for them
 * to work, and Google sometimes lifts them into a result as jump-to links —
 * which it can only do if they are in the HTML.
 *
 * Suppressed for short articles, where a contents list is longer than the
 * scroll it saves.
 */
export function TableOfContents({ entries }: { entries: TocEntry[] }) {
  if (entries.length < 3) return null;

  return (
    <nav aria-labelledby="toc-heading" className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
      <h2 id="toc-heading" className="text-xs font-semibold uppercase tracking-wide text-ink-500">
        In this article
      </h2>
      <ol className="mt-3 space-y-2 text-sm">
        {entries.map((entry, index) => (
          <li key={entry.id} className="flex gap-2.5">
            <span className="shrink-0 tabular-nums text-ink-300">{String(index + 1).padStart(2, '0')}</span>
            <a href={`#${entry.id}`} className="text-ink-600 transition hover:text-brand-600">
              {entry.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
