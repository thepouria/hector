import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/utils/routes';

export const metadata: Metadata = {
  title: 'مشتری جدید',
};

/** Create is dialog-based on the list page. */
export default function Page() {
  redirect(`${ROUTES.salesCustomers}?create=1`);
}
