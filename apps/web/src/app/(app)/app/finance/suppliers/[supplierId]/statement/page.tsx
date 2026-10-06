import { SupplierStatementPageClient } from '@/features/finance/supplier-statement-page';

export default async function FinanceSupplierStatementPage({
  params,
}: {
  params: Promise<{ supplierId: string }>;
}) {
  const { supplierId } = await params;
  return <SupplierStatementPageClient supplierId={supplierId} />;
}
