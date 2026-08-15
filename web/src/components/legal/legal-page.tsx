import type { ReactNode } from 'react';

export function LegalPage({
  title,
  intro,
  updated,
  children,
}: {
  title: string;
  intro: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <div className="container-page py-14 lg:py-16">
      <div className="max-w-3xl">
        <h1 className="text-3xl font-extrabold tracking-tight text-ink-900 sm:text-4xl">{title}</h1>
        <p className="mt-3 text-base leading-relaxed text-ink-500">{intro}</p>
        <p className="mt-4 inline-flex items-center rounded-full bg-ink-100 px-3 py-1 text-xs font-medium text-ink-600">
          Last updated: {updated}
        </p>

        <div className="mt-10 space-y-10">{children}</div>
      </div>
    </div>
  );
}

export function LegalSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-bold tracking-tight text-ink-900">{heading}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-600">{children}</div>
    </section>
  );
}

export function LegalList({ items }: { items: ReactNode[] }) {
  return (
    <ul className="list-disc space-y-2 pl-5 marker:text-brand-500">
      {items.map((item, index) => (
        <li key={index}>{item}</li>
      ))}
    </ul>
  );
}
