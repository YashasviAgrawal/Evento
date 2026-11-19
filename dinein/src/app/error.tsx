'use client';

import { RotateCcw } from 'lucide-react';

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="container-page grid min-h-[70vh] place-items-center text-center">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Something went wrong</h1>
        <p className="mt-1.5 text-ink-500">It’s us, not you. Please try again.</p>
        <button onClick={reset} className="press mt-6 inline-flex h-12 items-center gap-2 rounded-2xl bg-ink-900 px-6 font-bold text-white">
          <RotateCcw className="h-4 w-4" /> Try again
        </button>
      </div>
    </main>
  );
}
