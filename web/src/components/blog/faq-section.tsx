import { ChevronDown } from 'lucide-react';
import type { BlogFaqItem } from '@/lib/types';

/**
 * Frequently asked questions.
 *
 * Rendered visibly on the page, and separately emitted as FAQPage structured
 * data by the article route. Both are required: Google only honours FAQ markup
 * when the same question and answer are visible to a reader, and will treat
 * markup describing hidden content as spam.
 *
 * Native <details> rather than React state, so every answer is in the HTML,
 * collapsible without JavaScript, and expanded by the browser's own find-in-page.
 */
export function FaqSection({ items }: { items: BlogFaqItem[] }) {
  if (items.length === 0) return null;

  return (
    <section className="mt-14" aria-labelledby="faq-heading">
      <h2 id="faq-heading" className="text-2xl font-bold tracking-tight text-ink-900">
        Frequently asked questions
      </h2>

      <div className="mt-5 divide-y divide-ink-200 overflow-hidden rounded-xl border border-ink-200 bg-white shadow-card">
        {items.map((item) => (
          <details key={item.question} className="group">
            <summary className="flex cursor-pointer list-none items-start justify-between gap-4 p-5 text-sm font-semibold text-ink-900 transition hover:bg-ink-50">
              {item.question}
              <ChevronDown
                className="mt-0.5 h-4 w-4 shrink-0 text-ink-400 transition group-open:rotate-180"
                aria-hidden
              />
            </summary>
            <p className="px-5 pb-5 text-sm leading-relaxed text-ink-600">{item.answer}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
