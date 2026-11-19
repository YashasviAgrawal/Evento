import { SiteHeader } from '@/components/shell/site-header';
import { Footer } from '@/components/shell/footer';

export default function BrowseLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="min-h-[60vh]">{children}</main>
      <Footer />
    </>
  );
}
