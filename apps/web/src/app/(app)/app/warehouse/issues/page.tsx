import type { Metadata } from 'next';
import { IssuesPageClient } from '@/features/warehouse/issues-page';

export const metadata: Metadata = {
  title: 'خروج غیرفروشی',
};

export default function Page() {
  return <IssuesPageClient />;
}
