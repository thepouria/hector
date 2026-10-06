import { redirect } from 'next/navigation';
import { ROUTES } from '@/lib/utils/routes';

export default function AppIndexPage() {
  redirect(ROUTES.dashboard);
}
