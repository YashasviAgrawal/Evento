import type { Metadata } from 'next';
import { PassView } from './pass-view';

export const metadata: Metadata = {
  title: 'Tixit Pass',
  description: 'No platform fee on any restaurant bill, and double cashback, for one small price.',
};

export default function PassPage() {
  return <PassView />;
}
