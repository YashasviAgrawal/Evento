'use client';

import { use, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  ArrowLeft,
  CalendarDays,
  CheckCircle2,
  Download,
  MapPin,
  Printer,
  Receipt,
  RotateCcw,
  Ticket as TicketIcon,
  XCircle,
} from 'lucide-react';
import { api, ApiError, downloadFile } from '@/lib/api';
import type { BookingDetail, TicketView } from '@/lib/types';
import { RequireAuth } from '@/components/auth/require-auth';
import { AddToCalendar } from '@/components/events/add-to-calendar';
import { useToast } from '@/components/ui/toast';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert, Field, Skeleton, StatusBadge, Textarea } from '@/components/ui/index';
import { formatDateTime, formatEventDateTime, formatMoney } from '@/lib/format';


export default function BookingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <BookingView bookingId={id} />
    </RequireAuth>
  );
}

function BookingView({ bookingId }: { bookingId: string }) {
  const searchParams = useSearchParams();
  const toast = useToast();
  const isNew = searchParams.get('new') === '1';

  const [booking, setBooking] = useState<BookingDetail | null>(null);
  const [tickets, setTickets] = useState<TicketView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelling, setCancelling] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detail, ticketList] = await Promise.all([
        api.get<BookingDetail>(`/bookings/${bookingId}`),
        api.get<TicketView[]>(`/bookings/${bookingId}/tickets`).catch(() => ({ data: [] as TicketView[] })),
      ]);
      setBooking(detail.data);
      setTickets(ticketList.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this booking');
    } finally {
      setLoading(false);
    }
  }, [bookingId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadFile(`/tickets/booking/${bookingId}/download`, `tixit-${booking?.bookingCode ?? bookingId}.pdf`);
    } catch {
      toast.error('Download failed', 'Please try again in a moment.');
    } finally {
      setDownloading(false);
    }
  }

  async function handleCancel() {
    if (cancelReason.trim().length < 3) return;
    setCancelling(true);
    try {
      const { data } = await api.post<{ status: string; refundRequested: boolean }>(
        `/bookings/${bookingId}/cancel`,
        { reason: cancelReason.trim() },
      );
      toast.success(
        'Booking cancelled',
        data.refundRequested ? 'A refund request has been sent for review.' : undefined,
      );
      setCancelOpen(false);
      await load();
    } catch (err) {
      toast.error('Could not cancel', err instanceof ApiError ? err.message : undefined);
    } finally {
      setCancelling(false);
    }
  }

  if (loading) {
    return (
      <div className="container-page space-y-4 py-10">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !booking) {
    return (
      <div className="container-page py-16">
        <Alert tone="error" title="Booking unavailable">
          {error ?? 'We could not find that booking.'}{' '}
          <Link href="/account/bookings" className="font-semibold underline">
            Back to my bookings
          </Link>
        </Alert>
      </div>
    );
  }

  const canCancel = ['pending', 'confirmed'].includes(booking.status);

  return (
    <div className="container-page py-8 lg:py-10">
      <Link
        href="/account/bookings"
        className="no-print mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-ink-600 hover:text-ink-900"
      >
        <ArrowLeft className="h-4 w-4" />
        All bookings
      </Link>

      {isNew && booking.status === 'confirmed' && (
        <Alert tone="success" title="You’re going! 🎉" className="no-print mb-6">
          Your booking is confirmed and a confirmation email is on its way. Show the QR code below at the venue.
        </Alert>
      )}

      <div className="grid gap-7 lg:grid-cols-[1fr_360px]">
        {/* ── Tickets ── */}
        <div className="min-w-0 space-y-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-ink-900">{booking.event.title}</h1>
              <p className="mt-1.5 flex items-center gap-1.5 text-sm text-ink-500">
                <CalendarDays className="h-4 w-4" aria-hidden />
                {formatEventDateTime(booking.event.startsAt)}
              </p>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-ink-500">
                <MapPin className="h-4 w-4" aria-hidden />
                {booking.event.venueName}, {booking.event.addressLine1}, {booking.event.cityName}
              </p>
            </div>
            <StatusBadge status={booking.status} />
          </div>

          {tickets.length > 0 ? (
            <div className="space-y-4">
              {tickets.map((ticket, index) => (
                <article
                  key={ticket.id}
                  className="ticket print-break animate-enter"
                  style={{ animationDelay: `${index * 60}ms` }}
                >
                  {/* Header band, styled like the printed stub's brand bar. */}
                  <div className="flex items-center justify-between bg-ink-950 px-5 py-3">
                    <span className="text-sm font-bold text-white">
                      Ticket {index + 1} of {tickets.length}
                    </span>
                    <span className="font-mono text-xs text-ink-300">{ticket.ticketCode}</span>
                  </div>

                  {/* Main body: the details half of the ticket. */}
                  <div className="p-5">
                    <p className="text-lg font-bold leading-tight text-ink-900">{booking.event.title}</p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {formatEventDateTime(booking.event.startsAt)} · {booking.event.venueName}
                    </p>

                    <dl className="mt-4 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                      <Detail label="Attendee" value={ticket.attendeeName} />
                      <Detail label="Ticket type" value={ticket.ticketTypeName} />
                      <Detail label="Booking ID" value={<span className="font-mono">{ticket.bookingCode}</span>} />
                      <Detail
                        label="Status"
                        value={
                          ticket.status === 'used' ? (
                            <span className="inline-flex items-center gap-1 font-semibold text-sky-700">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              Checked in
                            </span>
                          ) : ticket.status === 'valid' ? (
                            <span className="font-semibold text-emerald-700">Valid</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 font-semibold text-rose-700">
                              <XCircle className="h-3.5 w-3.5" />
                              {ticket.status}
                            </span>
                          )
                        }
                      />
                    </dl>

                    {ticket.checkedInAt && (
                      <p className="mt-3 text-xs text-ink-500">
                        Checked in at {formatDateTime(ticket.checkedInAt)}
                      </p>
                    )}
                  </div>

                  {/* The tear line, with a notch punched out of each edge. */}
                  <div className="ticket-perforation px-4">
                    <span className="ticket-tear" />
                  </div>

                  {/* The stub: the part torn off and scanned at the gate. */}
                  <div className="ticket-stub flex flex-col items-center gap-4 p-5 sm:flex-row sm:items-center">
                    <div className="shrink-0 rounded-lg bg-white p-2 shadow-sm ring-1 ring-ink-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={ticket.qrDataUrl}
                        alt={`QR code for ticket ${ticket.ticketCode}`}
                        className="h-36 w-36"
                      />
                    </div>

                    <div className="min-w-0 flex-1 text-center sm:text-left">
                      <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Admit one</p>
                      <p className="mt-1 font-mono text-lg font-bold tracking-tight text-ink-900">
                        {ticket.ticketCode}
                      </p>
                      <p className="mt-2 text-xs leading-relaxed text-ink-500">
                        Show this QR code at the entrance. It works once — don&apos;t share a screenshot.
                      </p>
                      {ticket.seatLabel && (
                        <p className="mt-2 inline-block rounded-md bg-white px-2 py-1 text-xs font-medium text-ink-700 ring-1 ring-ink-200">
                          {ticket.seatLabel}
                        </p>
                      )}
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : booking.status === 'pending' ? (
            <Alert tone="warning" title="Payment not completed">
              Your seats are reserved but payment is still pending. Complete the payment to receive your QR tickets.
            </Alert>
          ) : (
            <Alert tone="info">No tickets were issued for this booking.</Alert>
          )}

          {/* ── Actions ── */}
          <div className="no-print flex flex-wrap gap-2">
            {tickets.length > 0 && (
              <>
                <Button onClick={handleDownload} loading={downloading}>
                  <Download className="h-4 w-4" />
                  Download PDF
                </Button>
                {/* Placed with the ticket actions: this is the moment someone
                    has just booked and is most likely to save the date. */}
                <AddToCalendar
                  event={{
                    title: booking.event.title,
                    description: `Booking ${booking.bookingCode} · ${booking.quantity} ticket(s)`,
                    location: `${booking.event.venueName}, ${booking.event.addressLine1}, ${booking.event.cityName}`,
                    startsAt: booking.event.startsAt,
                    endsAt: booking.event.endsAt,
                  }}
                  filename={`tixit-${booking.bookingCode}.ics`}
                />
                <Button variant="outline" onClick={() => window.print()}>
                  <Printer className="h-4 w-4" />
                  Print
                </Button>
              </>
            )}
            <ButtonLink href={`/events/${booking.event.slug}`} variant="outline">
              View event
            </ButtonLink>
            {canCancel && (
              <Button variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={() => setCancelOpen(true)}>
                <RotateCcw className="h-4 w-4" />
                Cancel booking
              </Button>
            )}
          </div>

          {cancelOpen && (
            <div className="no-print rounded-xl border border-rose-200 bg-rose-50 p-5">
              <h3 className="text-sm font-bold text-rose-900">Cancel this booking?</h3>
              <p className="mt-1 text-xs text-rose-700">
                Your tickets will be voided. If you paid, a refund request goes to our team for review.
              </p>
              <Field label="Reason" className="mt-3">
                <Textarea
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Tell us why you’re cancelling…"
                  rows={2}
                />
              </Field>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleCancel}
                  loading={cancelling}
                  disabled={cancelReason.trim().length < 3}
                >
                  Confirm cancellation
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setCancelOpen(false)}>
                  Keep my booking
                </Button>
              </div>
            </div>
          )}

          {booking.cancellationReason && (
            <Alert tone="warning" title="Cancelled">
              {booking.cancellationReason}
            </Alert>
          )}
        </div>

        {/* ── Receipt ── */}
        <aside className="no-print lg:sticky lg:top-24 lg:self-start">
          <div className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
            <h2 className="flex items-center gap-2 text-base font-bold text-ink-900">
              <Receipt className="h-4 w-4 text-brand-600" aria-hidden />
              Receipt
            </h2>

            <dl className="mt-4 space-y-2 text-sm">
              {booking.items.map((item) => (
                <div key={item.id} className="flex justify-between gap-3">
                  <dt className="min-w-0 text-ink-600">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-ink-400"> × {item.quantity}</span>
                  </dt>
                  <dd className="shrink-0 font-medium text-ink-900">{formatMoney(item.subtotalPaise)}</dd>
                </div>
              ))}
            </dl>

            <dl className="mt-4 space-y-2 border-t border-ink-100 pt-4 text-sm">
              <Line label="Subtotal" value={formatMoney(booking.subtotalPaise)} />
              {booking.discountPaise > 0 && (
                <Line
                  label={`Discount${booking.couponCode ? ` (${booking.couponCode})` : ''}`}
                  value={`−${formatMoney(booking.discountPaise)}`}
                  className="text-emerald-600"
                />
              )}
              <Line label="GST" value={formatMoney(booking.taxPaise)} />
              <Line label="Convenience fee" value={formatMoney(booking.convenienceFeePaise)} />
              {booking.refundedPaise > 0 && (
                <Line label="Refunded" value={`−${formatMoney(booking.refundedPaise)}`} className="text-violet-600" />
              )}
            </dl>

            <div className="mt-4 flex items-baseline justify-between border-t border-ink-200 pt-4">
              <span className="text-sm font-semibold text-ink-900">Total paid</span>
              <span className="text-lg font-extrabold text-ink-900">
                {formatMoney(booking.totalPaise, { withDecimals: true })}
              </span>
            </div>

            {booking.payments.length > 0 && booking.payments[0] && (
              <div className="mt-4 space-y-1.5 border-t border-ink-100 pt-4 text-xs text-ink-500">
                <p>
                  Paid via <span className="font-medium uppercase text-ink-700">{booking.payments[0].method}</span>
                </p>
                {booking.payments[0].paymentId && (
                  <p className="truncate font-mono">Ref: {booking.payments[0].paymentId}</p>
                )}
                <p>Booked {formatDateTime(booking.createdAt)}</p>
              </div>
            )}
          </div>

          <div className="mt-4 rounded-xl border border-ink-200 bg-white p-5 shadow-card">
            <h3 className="text-sm font-bold text-ink-900">Need help?</h3>
            <p className="mt-1.5 text-xs text-ink-500">Contact the organizer directly.</p>
            <p className="mt-2.5 text-sm font-medium text-ink-800">{booking.organizer.name}</p>
            {booking.organizer.email && (
              <a href={`mailto:${booking.organizer.email}`} className="text-xs text-brand-600 hover:underline">
                {booking.organizer.email}
              </a>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-ink-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-ink-900">{value}</dd>
    </div>
  );
}

function Line({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-600">{label}</dt>
      <dd className={`font-medium text-ink-900 ${className ?? ''}`}>{value}</dd>
    </div>
  );
}
