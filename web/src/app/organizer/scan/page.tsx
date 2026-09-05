'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import jsQR from 'jsqr';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Keyboard,
  RotateCcw,
  ScanLine,
  Users,
  XCircle,
} from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import type { CheckInResult, EventCard } from '@/lib/types';
import { PageHeader, StatCard } from '@/components/dashboard/shell';
import { Button } from '@/components/ui/button';
import { Alert, Field, Input, Select, Skeleton } from '@/components/ui/index';
import { useToast } from '@/components/ui/toast';
import { cn, formatDateTime, formatNumber } from '@/lib/format';

interface ScanLog extends CheckInResult {
  at: number;
}

export default function ScanPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
      <Scanner />
    </Suspense>
  );
}

function Scanner() {
  const searchParams = useSearchParams();
  const toast = useToast();

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  // Suppresses repeat scans of the same code while it stays in frame.
  const lastScanRef = useRef<{ payload: string; at: number }>({ payload: '', at: 0 });

  const [events, setEvents] = useState<EventCard[]>([]);
  const [eventId, setEventId] = useState(searchParams.get('eventId') ?? '');
  const [scanning, setScanning] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [result, setResult] = useState<CheckInResult | null>(null);
  const [log, setLog] = useState<ScanLog[]>([]);
  const [manualCode, setManualCode] = useState('');
  const [checking, setChecking] = useState(false);
  const [stats, setStats] = useState<{ total: number; checkedIn: number; remaining: number } | null>(null);

  useEffect(() => {
    api
      .get<EventCard[]>('/organizer/events', { query: { status: 'published', limit: 50 } })
      .then((response) => setEvents(response.data))
      .catch(() => setEvents([]));
  }, []);

  const loadStats = useCallback(async () => {
    if (!eventId) {
      setStats(null);
      return;
    }
    try {
      const { data } = await api.get<{ total: number; checkedIn: number; remaining: number }>(
        `/organizer/events/${eventId}/checkin-stats`,
      );
      setStats(data);
    } catch {
      setStats(null);
    }
  }, [eventId]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const submitScan = useCallback(
    async (payload: string) => {
      setChecking(true);
      try {
        const { data } = await api.post<CheckInResult>('/organizer/checkin', {
          payload,
          eventId: eventId || undefined,
        });
        setResult(data);
        setLog((current) => [{ ...data, at: Date.now() }, ...current].slice(0, 20));

        if (data.status === 'admitted') {
          toast.success('Admitted', data.ticket?.attendeeName);
          // A short vibration is the fastest feedback for someone at a gate.
          if ('vibrate' in navigator) navigator.vibrate?.(80);
        } else {
          toast.error(data.status.replace(/_/g, ' '), data.message);
          if ('vibrate' in navigator) navigator.vibrate?.([60, 60, 60]);
        }
        void loadStats();
      } catch (err) {
        const message = err instanceof ApiError ? err.message : 'Scan failed';
        setResult({ status: 'invalid', message });
        toast.error('Scan failed', message);
      } finally {
        setChecking(false);
      }
    },
    [eventId, toast, loadStats],
  );

  /** Grab a frame, decode it, and submit any new QR payload found. */
  const tick = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (video && canvas && video.readyState === video.HAVE_ENOUGH_DATA) {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (context) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        context.drawImage(video, 0, 0, canvas.width, canvas.height);

        const image = context.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' });

        if (code?.data) {
          const now = Date.now();
          const isRepeat = code.data === lastScanRef.current.payload && now - lastScanRef.current.at < 3000;
          if (!isRepeat) {
            lastScanRef.current = { payload: code.data, at: now };
            void submitScan(code.data);
          }
        }
      }
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [submitScan]);

  async function startCamera() {
    setCameraError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setScanning(true);
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setCameraError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? 'Camera access was denied. Allow it in your browser settings, or use manual entry below.'
          : 'No camera available. Use manual entry below.',
      );
    }
  }

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }, []);

  // Always release the camera when leaving the page.
  useEffect(() => stopCamera, [stopCamera]);

  async function submitManual(event: React.FormEvent) {
    event.preventDefault();
    if (!manualCode.trim()) return;
    await submitScan(manualCode.trim());
    setManualCode('');
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Scan tickets" description="Check attendees in at the door with their QR code" />

      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-5">
          <Field label="Event" hint="Restricts scanning to one event — leave blank to accept any of your events">
            <Select value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">All my events</option>
              {events.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))}
            </Select>
          </Field>

          {/* ── Camera ── */}
          <div className="overflow-hidden rounded-xl border border-ink-200 bg-ink-950 shadow-card">
            <div className="relative aspect-[4/3] w-full">
              <video ref={videoRef} className="h-full w-full object-cover" playsInline muted />
              <canvas ref={canvasRef} className="hidden" />

              {!scanning && (
                <div className="absolute inset-0 grid place-items-center bg-ink-950/90 p-6 text-center">
                  <div>
                    <ScanLine className="mx-auto h-10 w-10 text-ink-500" aria-hidden />
                    <p className="mt-3 text-sm font-medium text-white">Camera is off</p>
                    <p className="mt-1 text-xs text-ink-400">Start the camera to scan QR tickets</p>
                    <Button className="mt-4" onClick={startCamera}>
                      <Camera className="h-4 w-4" />
                      Start camera
                    </Button>
                  </div>
                </div>
              )}

              {scanning && (
                <>
                  {/* Framing reticle */}
                  <div aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
                    <div className="relative h-52 w-52">
                      {['left-0 top-0 border-l-4 border-t-4', 'right-0 top-0 border-r-4 border-t-4', 'bottom-0 left-0 border-b-4 border-l-4', 'bottom-0 right-0 border-b-4 border-r-4'].map(
                        (position) => (
                          <span key={position} className={cn('absolute h-8 w-8 border-brand-500', position)} />
                        ),
                      )}
                    </div>
                  </div>
                  <div className="absolute inset-x-0 bottom-0 flex justify-center p-4">
                    <Button variant="secondary" size="sm" onClick={stopCamera}>
                      <CameraOff className="h-4 w-4" />
                      Stop camera
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>

          {cameraError && <Alert tone="warning">{cameraError}</Alert>}

          {/* ── Manual entry ── */}
          <form onSubmit={submitManual} className="rounded-xl border border-ink-200 bg-white p-5 shadow-card">
            <h2 className="flex items-center gap-2 text-sm font-bold text-ink-900">
              <Keyboard className="h-4 w-4 text-ink-400" aria-hidden />
              Manual entry
            </h2>
            <p className="mt-0.5 text-xs text-ink-500">
              Type the ticket code printed on the ticket if the QR won&apos;t scan (e.g. TKT-9QP4X7R2).
              The TKT- prefix is optional.
            </p>
            <div className="mt-3 flex gap-2">
              <Input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value.toUpperCase())}
                placeholder="TKT-XXXXXXXX"
                className="font-mono"
              />
              <Button type="submit" loading={checking} disabled={!manualCode.trim()}>
                Check in
              </Button>
            </div>
          </form>
        </div>

        {/* ── Result + stats ── */}
        <div className="space-y-5">
          {stats && (
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Checked in" value={formatNumber(stats.checkedIn)} tone="success" icon={<Users className="h-4 w-4" />} />
              <StatCard label="Yet to arrive" value={formatNumber(stats.remaining)} />
            </div>
          )}

          <ResultPanel result={result} onClear={() => setResult(null)} />

          <div className="rounded-xl border border-ink-200 bg-white shadow-card">
            <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
              <h2 className="text-sm font-bold text-ink-900">Recent scans</h2>
              {log.length > 0 && (
                <button onClick={() => setLog([])} className="text-xs text-ink-500 hover:text-ink-800">
                  Clear
                </button>
              )}
            </div>

            {log.length === 0 ? (
              <p className="p-5 text-center text-xs text-ink-400">Scans will appear here</p>
            ) : (
              <ul className="max-h-80 divide-y divide-ink-100 overflow-y-auto">
                {log.map((entry, index) => (
                  <li key={`${entry.ticket?.ticketCode}-${entry.at}-${index}`} className="flex items-start gap-2.5 px-4 py-2.5">
                    {entry.status === 'admitted' ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
                    ) : (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-ink-900">
                        {entry.ticket?.attendeeName ?? 'Unknown ticket'}
                      </p>
                      <p className="truncate text-xs text-ink-500">{entry.message}</p>
                    </div>
                    <span className="shrink-0 text-[10px] text-ink-400">
                      {new Date(entry.at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function ResultPanel({ result, onClear }: { result: CheckInResult | null; onClear: () => void }) {
  if (!result) {
    return (
      <div className="grid h-40 place-items-center rounded-xl border border-dashed border-ink-300 bg-white text-center">
        <div>
          <ScanLine className="mx-auto h-7 w-7 text-ink-300" aria-hidden />
          <p className="mt-2 text-sm text-ink-500">Point the camera at a ticket QR</p>
        </div>
      </div>
    );
  }

  const admitted = result.status === 'admitted';
  const tone = admitted
    ? 'border-emerald-300 bg-emerald-50'
    : result.status === 'already_used'
      ? 'border-amber-300 bg-amber-50'
      : 'border-rose-300 bg-rose-50';

  return (
    <div className={cn('rounded-xl border-2 p-5 shadow-card', tone)} role="status" aria-live="assertive">
      <div className="flex items-start gap-3">
        {admitted ? (
          <CheckCircle2 className="h-7 w-7 shrink-0 text-emerald-600" aria-hidden />
        ) : (
          <XCircle className="h-7 w-7 shrink-0 text-rose-600" aria-hidden />
        )}
        <div className="min-w-0 flex-1">
          <p
            className={cn(
              'text-base font-bold capitalize',
              admitted ? 'text-emerald-900' : result.status === 'already_used' ? 'text-amber-900' : 'text-rose-900',
            )}
          >
            {result.status.replace(/_/g, ' ')}
          </p>
          <p className="mt-0.5 text-sm text-ink-700">{result.message}</p>

          {result.ticket && (
            <dl className="mt-3 space-y-1 border-t border-black/10 pt-3 text-xs">
              <Row label="Attendee" value={result.ticket.attendeeName} />
              <Row label="Ticket" value={result.ticket.ticketTypeName} />
              <Row label="Booking" value={result.ticket.bookingCode} mono />
              <Row label="Event" value={result.ticket.eventTitle} />
              {result.ticket.checkedInAt && (
                <Row label="Checked in" value={formatDateTime(result.ticket.checkedInAt)} />
              )}
            </dl>
          )}

          <button
            onClick={onClear}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 hover:text-ink-900"
          >
            <RotateCcw className="h-3 w-3" />
            Clear
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-500">{label}</dt>
      <dd className={cn('truncate text-right font-medium text-ink-900', mono && 'font-mono')}>{value}</dd>
    </div>
  );
}
