'use client';

import { useEffect, useRef, useState } from 'react';
import { CalendarPlus, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { downloadIcs, googleCalendarUrl, outlookCalendarUrl, type CalendarEvent } from '@/lib/calendar';

/**
 * Put the event in the attendee's calendar.
 *
 * The cheapest lever there is on no-shows, which is the number organizers care
 * about most — and it is already on their dashboard as "attendance rate".
 * The generated entry carries reminders a day and an hour before.
 */
export function AddToCalendar({
  event,
  filename,
  variant = 'outline',
  className,
}: {
  event: CalendarEvent;
  filename?: string;
  variant?: 'outline' | 'ghost' | 'secondary' | 'primary';
  className?: string;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  function saveIcs() {
    downloadIcs(event, filename ?? 'tixit-event.ics');
    toast.success('Calendar file downloaded', 'Open it to add the event.');
    setOpen(false);
  }

  return (
    <div className="relative" ref={menuRef}>
      <Button variant={variant} size="sm" onClick={() => setOpen((v) => !v)} className={className} aria-expanded={open}>
        <CalendarPlus className="h-4 w-4" />
        Add to calendar
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-56 animate-fade-up overflow-hidden rounded-xl border border-ink-200 bg-white py-1 shadow-lift"
        >
          <a
            href={googleCalendarUrl(event)}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-ink-700 transition hover:bg-ink-100"
          >
            <CalendarPlus className="h-4 w-4 text-ink-400" />
            Google Calendar
          </a>

          <a
            href={outlookCalendarUrl(event)}
            target="_blank"
            rel="noopener noreferrer"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-ink-700 transition hover:bg-ink-100"
          >
            <CalendarPlus className="h-4 w-4 text-ink-400" />
            Outlook
          </a>

          <button
            onClick={saveIcs}
            role="menuitem"
            className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-ink-700 transition hover:bg-ink-100"
          >
            <Download className="h-4 w-4 text-ink-400" />
            Apple / other (.ics)
          </button>
        </div>
      )}
    </div>
  );
}
