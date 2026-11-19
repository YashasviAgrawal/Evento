import type { Metadata } from 'next';
import { Mail, MapPin, Phone, Scale } from 'lucide-react';
import { fetchPublic } from '@tixit/session';
import { GrievanceForm } from './grievance-form';

export const metadata: Metadata = {
  title: 'Grievance officer',
  description: 'Raise a complaint about a payment, booking, restaurant or your data. We acknowledge at once and resolve within 30 days.',
};

interface Officer {
  name: string;
  email: string;
  phone: string | null;
  address: string;
  responseDays: number;
}

export default async function GrievancePage() {
  const officer = await fetchPublic<Officer>('/privacy/grievance-officer', undefined, 3600);
  return (
    <div className="container-page max-w-3xl py-6 sm:py-10">
      <h1 className="flex items-center gap-2 text-2xl font-extrabold tracking-tight sm:text-3xl">
        <Scale className="h-7 w-7 text-brand-600" /> Grievance redressal
      </h1>
      <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-ink-600">
        Something went wrong with a payment, a booking, a restaurant or your data? Tell us here. You get a reference straight away, and a
        response within {officer?.responseDays ?? 30} days.
      </p>

      {officer && (
        <div className="mt-6 grid gap-3 rounded-3xl bg-white p-5 ring-1 ring-ink-200 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <p className="eyebrow text-ink-400">Grievance officer</p>
            <p className="mt-1 text-lg font-bold">{officer.name}</p>
          </div>
          <a href={`mailto:${officer.email}`} className="flex items-center gap-2 text-sm font-semibold text-brand-700">
            <Mail className="h-4 w-4" /> {officer.email}
          </a>
          {officer.phone && (
            <a href={`tel:${officer.phone}`} className="flex items-center gap-2 text-sm font-semibold text-ink-700">
              <Phone className="h-4 w-4" /> {officer.phone}
            </a>
          )}
          <p className="flex items-start gap-2 text-sm text-ink-600 sm:col-span-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" /> {officer.address}
          </p>
        </div>
      )}

      <GrievanceForm />
    </div>
  );
}
