'use client';

import { use, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Copy, Plus, Trash2 } from 'lucide-react';
import { ApiError, api } from '@tixit/session';
import { useToast } from '@tixit/ui';
import type { Availability, AvailabilityRule } from '@/lib/types';
import { cn, dayPill, localDate } from '@/lib/format';
import { PageHeading } from '@/components/partner/partner-shell';
import { Toggle } from '@/components/ui/controls';
import { Skeleton } from '@/components/ui/feedback';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ORDER = [1, 2, 3, 4, 5, 6, 0];
const LENGTHS = [15, 30, 45, 60] as const;

const blank = (weekday: number): AvailabilityRule => ({ weekday, startTime: '19:00', endTime: '22:30', slotMinutes: 30, coversPerSlot: 20, maxParty: 10 });

/**
 * Seating hours as a restaurant thinks about them: per day, one or more
 * windows ("lunch 12:30–15:00, dinner 19:00–22:30"), each with how many
 * covers a slot can take. Saving never disturbs tables already booked.
 */
export default function PartnerAvailabilityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const toast = useToast();
  const queryClient = useQueryClient();
  const [rules, setRules] = useState<AvailabilityRule[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const [closeDate, setCloseDate] = useState(localDate());

  const availability = useQuery({
    queryKey: ['partner-availability', id],
    queryFn: async () => (await api.get<Availability>(`/partner/r/${id}/availability`)).data,
  });

  useEffect(() => {
    if (availability.data && !dirty) setRules(availability.data.rules);
  }, [availability.data, dirty]);

  const setData = (data: Availability) => queryClient.setQueryData(['partner-availability', id], data);

  const save = useMutation({
    mutationFn: async () => (await api.put<Availability>(`/partner/r/${id}/availability/rules`, { rules })).data,
    onSuccess: (data) => {
      setDirty(false);
      setData(data);
      toast.success('Hours saved', 'Booked tables are untouched; new slots follow these hours.');
    },
    onError: (error) => toast.error('Could not save', error instanceof ApiError ? (error.fieldMessages[0] ?? error.message) : undefined),
  });

  const settings = useMutation({
    mutationFn: async (patch: Partial<Availability['settings']>) =>
      (await api.patch<Availability>(`/partner/r/${id}/availability/settings`, patch)).data,
    onSuccess: setData,
  });

  const closure = useMutation({
    mutationFn: async (input: { date: string; closed: boolean }) =>
      (await api.post<{ date: string; closed: boolean; existingBookings: number }>(`/partner/r/${id}/availability/closures`, input)).data,
    onSuccess: (result) => {
      void availability.refetch();
      if (result.closed) {
        toast.success(
          `${dayPill(result.date).top} ${dayPill(result.date).day} ${dayPill(result.date).month} closed`,
          result.existingBookings ? `${result.existingBookings} existing booking(s) — please call those guests.` : 'No bookings were affected.',
        );
      } else toast.success('Date reopened');
    },
  });

  function edit(next: AvailabilityRule[]) {
    setRules(next);
    setDirty(true);
  }
  const update = (index: number, patch: Partial<AvailabilityRule>) =>
    edit(rules!.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));

  function copyToAll(weekday: number) {
    const source = rules!.filter((rule) => rule.weekday === weekday);
    edit([0, 1, 2, 3, 4, 5, 6].flatMap((day) => (day === weekday ? source : source.map((rule) => ({ ...rule, weekday: day })))));
  }

  if (availability.isLoading || !rules || !availability.data) {
    return <div className="p-4 sm:p-8"><Skeleton className="h-96 rounded-3xl" /></div>;
  }
  const { settings: current, closedDates } = availability.data;

  return (
    <>
      <PageHeading
        title="Hours & tables"
        subtitle="When diners can book, and how many covers each time slot takes."
        action={
          <button
            onClick={() => save.mutate()}
            disabled={!dirty || save.isPending}
            className="press h-10 rounded-xl bg-brand-600 px-5 text-sm font-bold text-white shadow-glow disabled:bg-ink-200 disabled:text-ink-500 disabled:shadow-none"
          >
            {save.isPending ? 'Saving…' : dirty ? 'Save hours' : 'Saved'}
          </button>
        }
      />

      <div className="grid gap-6 px-4 pb-12 pt-5 sm:px-8 xl:grid-cols-[1.6fr_1fr]">
        <section className="space-y-3">
          {ORDER.map((weekday) => {
            const windows = rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => rule.weekday === weekday);
            return (
              <div key={weekday} className="rounded-3xl bg-white p-4 ring-1 ring-ink-200">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-bold">{DAYS[weekday]}</h2>
                  <div className="flex gap-1">
                    {windows.length > 0 && (
                      <button onClick={() => copyToAll(weekday)} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold text-ink-500 hover:bg-ink-50">
                        <Copy className="h-3.5 w-3.5" /> Copy to all days
                      </button>
                    )}
                    <button onClick={() => edit([...rules, blank(weekday)])} className="inline-flex h-8 items-center gap-1 rounded-lg px-2.5 text-xs font-bold text-brand-600 hover:bg-brand-50">
                      <Plus className="h-3.5 w-3.5" /> Window
                    </button>
                  </div>
                </div>
                {windows.length === 0 ? (
                  <p className="mt-2 text-sm text-ink-400">Closed for bookings</p>
                ) : (
                  <ul className="mt-3 space-y-2">
                    {windows.map(({ rule, index }) => (
                      <li key={index} className="grid grid-cols-2 items-end gap-2 rounded-2xl bg-ink-50 p-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto]">
                        <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
                          First seating
                          <input type="time" value={rule.startTime} onChange={(e) => update(index, { startTime: e.target.value })} className="input mt-1 h-10 py-1.5" />
                        </label>
                        <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
                          Last seating
                          <input type="time" value={rule.endTime} onChange={(e) => update(index, { endTime: e.target.value })} className="input mt-1 h-10 py-1.5" />
                        </label>
                        <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
                          Every
                          <select
                            value={rule.slotMinutes}
                            onChange={(e) => update(index, { slotMinutes: Number(e.target.value) as AvailabilityRule['slotMinutes'] })}
                            className="input mt-1 h-10 py-1.5"
                          >
                            {LENGTHS.map((minutes) => (
                              <option key={minutes} value={minutes}>{minutes} min</option>
                            ))}
                          </select>
                        </label>
                        <label className="text-[11px] font-bold uppercase tracking-wider text-ink-400">
                          Covers / slot
                          <input
                            inputMode="numeric"
                            value={rule.coversPerSlot}
                            onChange={(e) => update(index, { coversPerSlot: Math.max(1, Number(e.target.value.replace(/\D/g, '')) || 1) })}
                            className="input mt-1 h-10 py-1.5"
                          />
                        </label>
                        <button
                          onClick={() => edit(rules.filter((_, i) => i !== index))}
                          className="col-span-2 grid h-10 place-items-center rounded-xl text-ink-400 hover:bg-rose-50 hover:text-rose-600 sm:col-span-1 sm:w-10"
                          aria-label={`Remove ${DAYS[weekday]} window`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start">
          <div className="space-y-2">
            <h2 className="eyebrow text-ink-400">How bookings work</h2>
            <Toggle
              checked={current.bookingEnabled}
              onChange={(value) => settings.mutate({ bookingEnabled: value })}
              label="Take table bookings"
              description="Turn off to stop new bookings; existing ones stay"
            />
            <Toggle
              checked={current.autoAccept}
              onChange={(value) => settings.mutate({ autoAccept: value })}
              label="Confirm bookings instantly"
              description="Off: you accept each request from the Live screen"
            />
            <Toggle
              checked={current.payBillEnabled}
              onChange={(value) => settings.mutate({ payBillEnabled: value })}
              label="Accept Pay Bill on Tixit"
              description="Diners pay at the table and you verify on Live"
            />
          </div>

          <div className="rounded-3xl bg-white p-4 ring-1 ring-ink-200">
            <h2 className="flex items-center gap-2 font-bold">
              <CalendarOff className="h-4 w-4 text-ink-400" /> Close a date
            </h2>
            <p className="mt-1 text-xs text-ink-500">A private event or a holiday. Existing bookings are kept — we tell you how many to call.</p>
            <div className="mt-3 flex gap-2">
              <input type="date" min={localDate()} value={closeDate} onChange={(e) => setCloseDate(e.target.value)} className="input h-11" />
              <button
                onClick={() => closure.mutate({ date: closeDate, closed: true })}
                disabled={closure.isPending || closedDates.includes(closeDate)}
                className="press h-11 shrink-0 rounded-xl bg-ink-900 px-4 text-sm font-bold text-white disabled:opacity-50"
              >
                Close
              </button>
            </div>
            {closedDates.length > 0 && (
              <ul className="mt-3 space-y-1.5">
                {closedDates.map((date) => {
                  const pill = dayPill(date);
                  return (
                    <li key={date} className="flex items-center justify-between rounded-xl bg-rose-50 px-3 py-2 text-sm">
                      <span className="font-semibold text-rose-800">
                        {pill.top} {pill.day} {pill.month}
                      </span>
                      <button onClick={() => closure.mutate({ date, closed: false })} className="text-xs font-bold text-rose-700 hover:underline">
                        Reopen
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <p className={cn('px-1 text-xs text-ink-400', !dirty && 'hidden')}>You have unsaved changes to your weekly hours.</p>
        </aside>
      </div>
    </>
  );
}
