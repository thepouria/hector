import type { Metadata } from 'next';
import { AccountTransferCreatePageClient } from '@/features/finance/account-transfer-create-page';

export const metadata: Metadata = {
  title: 'انتقال بین حساب‌ها',
};

export default function Page() {
  return <AccountTransferCreatePageClient />;
}
