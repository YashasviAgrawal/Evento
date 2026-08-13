import Link from 'next/link';

export type LegalSection = {
  heading: string;
  body: React.ReactNode;
};

/**
 * Shared shell for the static policy pages (Terms, Privacy, Refunds). Renders a
 * breadcrumb, title, "last updated" line and a numbered set of sections so the
 * three pages stay visually consistent with the rest of the site.
 */
export function LegalPage({
  title,
  summary,
  updated,
  sections,
}: {
  title: string;
  summary: string;
  updated: string;
  sections: LegalSection[];
}) {
  return (
    <div className="container-page py-8 lg:py-12">
      <nav aria-label="Breadcrumb" className="mb-4 text-sm text-ink-500">
        <Link href="/" className="hover:text-ink-800">
          Home
        </Link>
        <span className="mx-1.5">/</span>
        <span className="text-ink-800">{title}</span>
      </nav>

      <div className="mx-auto max-w-3xl">
        <header className="border-b border-ink-200 pb-6">
          <h1 className="text-3xl font-bold tracking-tight text-ink-900 sm:text-4xl">{title}</h1>
          <p className="mt-3 text-base leading-relaxed text-ink-600">{summary}</p>
          <p className="mt-4 text-sm text-ink-500">Last updated: {updated}</p>
        </header>

        <div className="mt-8 space-y-9">
          {sections.map((section, index) => (
            <section key={section.heading} aria-labelledby={`section-${index}`}>
              <h2 id={`section-${index}`} className="text-lg font-semibold text-ink-900">
                <span className="mr-2 text-brand-600">{index + 1}.</span>
                {section.heading}
              </h2>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-700 [&_a]:font-medium [&_a]:text-brand-600 [&_a:hover]:underline [&_li]:ml-1 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
                {section.body}
              </div>
            </section>
          ))}
        </div>

        <div className="mt-12 rounded-xl border border-ink-200 bg-ink-50 p-5 text-sm text-ink-600">
          Questions about this policy? Email us at{' '}
          <a href="mailto:support@evento.test" className="font-medium text-brand-600 hover:underline">
            support@evento.test
          </a>{' '}
          or visit our{' '}
          <Link href="/support" className="font-medium text-brand-600 hover:underline">
            Help &amp; Support
          </Link>{' '}
          page.
        </div>
      </div>
    </div>
  );
}
