/**
 * Add-to-calendar helpers.
 *
 * Two routes because they suit different devices: a Google Calendar URL is one
 * tap on desktop and Android, while an .ics download is what iOS and Outlook
 * users need. Both are generated entirely client-side — no server round trip
 * and no third-party calendar service involved.
 */

export interface CalendarEvent {
  title: string;
  description?: string;
  location?: string;
  startsAt: string | Date;
  endsAt: string | Date;
  url?: string;
}

/** Calendar formats want UTC basic-format timestamps: 20260811T133000Z */
function toStamp(value: string | Date): string {
  return new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * Escape per RFC 5545: backslash, semicolon and comma are field separators,
 * and newlines must be encoded rather than emitted literally.
 */
function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * RFC 5545 caps lines at 75 octets; longer ones are folded onto continuation
 * lines beginning with a space. Outlook in particular rejects unfolded input.
 */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) chunks.push(` ${line.slice(i, i + 74)}`);
  return chunks.join('\r\n');
}

export function buildIcs(event: CalendarEvent): string {
  const uid = `${toStamp(event.startsAt)}-${Math.random().toString(36).slice(2, 10)}@evento`;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Evento//Ticket//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toStamp(new Date())}`,
    `DTSTART:${toStamp(event.startsAt)}`,
    `DTEND:${toStamp(event.endsAt)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    ...(event.description ? [`DESCRIPTION:${escapeIcs(event.description)}`] : []),
    ...(event.location ? [`LOCATION:${escapeIcs(event.location)}`] : []),
    ...(event.url ? [`URL:${escapeIcs(event.url)}`] : []),
    'STATUS:CONFIRMED',
    // Two nudges: the day before, and an hour ahead.
    'BEGIN:VALARM',
    'TRIGGER:-P1D',
    'ACTION:DISPLAY',
    'DESCRIPTION:Your event is tomorrow',
    'END:VALARM',
    'BEGIN:VALARM',
    'TRIGGER:-PT1H',
    'ACTION:DISPLAY',
    'DESCRIPTION:Your event starts in an hour',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  // CRLF line endings are mandatory in RFC 5545.
  return lines.map(fold).join('\r\n');
}

export function downloadIcs(event: CalendarEvent, filename = 'evento-ticket.ics'): void {
  const blob = new Blob([buildIcs(event)], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.ics') ? filename : `${filename}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${toStamp(event.startsAt)}/${toStamp(event.endsAt)}`,
  });

  if (event.description) params.set('details', event.description);
  if (event.location) params.set('location', event.location);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

export function outlookCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: event.title,
    startdt: new Date(event.startsAt).toISOString(),
    enddt: new Date(event.endsAt).toISOString(),
  });

  if (event.description) params.set('body', event.description);
  if (event.location) params.set('location', event.location);

  return `https://outlook.live.com/calendar/0/deeplink/compose?${params.toString()}`;
}
