import type { LucideIcon } from 'lucide-react';
import {
  Boxes,
  ClipboardList,
  FolderTree,
  LayoutDashboard,
  LayoutGrid,
  Package,
  RotateCcw,
  Tags,
  Truck,
  ReceiptText,
  ScrollText,
  Settings,
  SlidersHorizontal,
  ShoppingBag,
  WalletCards,
  Warehouse,
  PackageCheck,
  Layers,
  ArrowDownToLine,
  PackageSearch,
  ArrowLeftRight,
  PackageMinus,
  PackagePlus,
  ListChecks,
  Bookmark,
  CircleDollarSign,
  ScanBarcode,
  Landmark,
  FileSpreadsheet,
  History,
  Users,
  Store,
} from 'lucide-react';
import { PERMISSIONS, type PermissionKey } from '@/lib/permissions/keys';
import { ROUTES } from '@/lib/utils/routes';

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  permission?: PermissionKey;
  placeholder?: boolean;
  /** Highlight only on an exact path match (for section landing pages). */
  exact?: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAVIGATION: NavGroup[] = [
  {
    label: 'نمای کلی',
    items: [
      {
        label: 'داشبورد',
        href: ROUTES.dashboard,
        icon: LayoutDashboard,
      },
    ],
  },
  {
    label: 'کاتالوگ',
    items: [
      {
        label: 'نمای کلی',
        href: ROUTES.catalog,
        icon: LayoutGrid,
        permission: PERMISSIONS.CATALOG_READ,
        exact: true,
      },
      {
        label: 'محصولات',
        href: ROUTES.catalogProducts,
        icon: Package,
        permission: PERMISSIONS.CATALOG_READ,
      },
      {
        label: 'SKUها',
        href: ROUTES.catalogSkus,
        icon: Boxes,
        permission: PERMISSIONS.CATALOG_READ,
      },
      {
        label: 'دسته‌بندی‌ها',
        href: ROUTES.catalogCategories,
        icon: FolderTree,
        permission: PERMISSIONS.CATALOG_READ,
      },
      {
        label: 'برندها',
        href: ROUTES.catalogBrands,
        icon: Tags,
        permission: PERMISSIONS.CATALOG_READ,
      },
      {
        label: 'مشخصات محصولات',
        href: ROUTES.catalogAttributes,
        icon: SlidersHorizontal,
        permission: PERMISSIONS.CATALOG_READ,
      },
    ],
  },
  {
    label: 'عملیات',
    items: [
      {
        label: 'داشبورد انبار',
        href: ROUTES.warehouseDashboard,
        icon: LayoutDashboard,
        permission: PERMISSIONS.WAREHOUSE_STOCK_READ,
        exact: true,
      },
      {
        label: 'مرکز اسکنر',
        href: ROUTES.warehouseScanner,
        icon: ScanBarcode,
        permission: PERMISSIONS.WAREHOUSE_SCANNER_USE,
      },
      {
        label: 'موجودی فیزیکی',
        href: ROUTES.warehouseInventory,
        icon: PackageSearch,
        permission: PERMISSIONS.WAREHOUSE_STOCK_READ,
      },
      {
        label: 'رسید کالا',
        href: ROUTES.warehouseGoodsReceipts,
        icon: PackageCheck,
        permission: PERMISSIONS.WAREHOUSE_RECEIPT_READ,
      },
      {
        label: 'جایگذاری',
        href: ROUTES.warehousePutaways,
        icon: ArrowDownToLine,
        permission: PERMISSIONS.WAREHOUSE_PUTAWAY_READ,
      },
      {
        label: 'انتقال داخلی',
        href: ROUTES.warehouseTransfers,
        icon: Truck,
        permission: PERMISSIONS.WAREHOUSE_TRANSFER_READ,
      },
      {
        label: 'خروج غیرفروشی',
        href: ROUTES.warehouseIssues,
        icon: PackageMinus,
        permission: PERMISSIONS.WAREHOUSE_ISSUE_READ,
      },
      {
        label: 'تعدیل موجودی',
        href: ROUTES.warehouseAdjustments,
        icon: PackagePlus,
        permission: PERMISSIONS.WAREHOUSE_ADJUSTMENT_READ,
      },
      {
        label: 'شمارش موجودی',
        href: ROUTES.warehouseCounts,
        icon: ListChecks,
        permission: PERMISSIONS.WAREHOUSE_COUNT_READ,
      },
      {
        label: 'برگشت به تأمین‌کننده',
        href: ROUTES.warehouseSupplierReturns,
        icon: RotateCcw,
        permission: PERMISSIONS.WAREHOUSE_SUPPLIER_RETURN_READ,
      },
      {
        label: 'رزرو موجودی',
        href: ROUTES.warehouseReservations,
        icon: Bookmark,
        permission: PERMISSIONS.WAREHOUSE_RESERVATION_READ,
      },
      {
        label: 'حرکات انبار',
        href: ROUTES.warehouseInventoryMovements,
        icon: ArrowLeftRight,
        permission: PERMISSIONS.WAREHOUSE_STOCK_READ,
      },
      {
        label: 'انبارها',
        href: ROUTES.warehouse,
        icon: Warehouse,
        permission: PERMISSIONS.WAREHOUSE_READ,
      },
      {
        label: 'بچ / سری ساخت',
        href: ROUTES.warehouseBatches,
        icon: Layers,
        permission: PERMISSIONS.WAREHOUSE_BATCH_READ,
      },
      {
        label: 'لایه‌های بهای تمام‌شده',
        href: ROUTES.warehouseCostLayers,
        icon: Layers,
        permission: PERMISSIONS.WAREHOUSE_COST_LAYER_READ,
      },
      {
        label: 'ارزش‌گذاری موجودی',
        href: ROUTES.warehouseValuation,
        icon: CircleDollarSign,
        permission: PERMISSIONS.WAREHOUSE_VALUATION_READ,
      },
    ],
  },
  {
    label: 'خرید',
    items: [
      {
        label: 'داشبورد خرید',
        href: ROUTES.purchasing,
        icon: LayoutGrid,
        permission: PERMISSIONS.PURCHASING_READ,
        exact: true,
      },
      {
        label: 'تأمین‌کنندگان',
        href: ROUTES.purchasingSuppliers,
        icon: Truck,
        permission: PERMISSIONS.PURCHASING_READ,
      },
      {
        label: 'استعلام قیمت',
        href: ROUTES.purchasingOffers,
        icon: Tags,
        permission: PERMISSIONS.PURCHASING_READ,
      },
      {
        label: 'سفارش‌های خرید',
        href: ROUTES.purchasingOrders,
        icon: ClipboardList,
        permission: PERMISSIONS.PURCHASING_READ,
      },
      {
        label: 'برگشت به تأمین‌کننده',
        href: ROUTES.purchasingReturns,
        icon: RotateCcw,
        permission: PERMISSIONS.PURCHASING_READ,
      },
    ],
  },
  {
    label: 'فروش',
    items: [
      {
        label: 'داشبورد فروش',
        href: ROUTES.sales,
        icon: LayoutDashboard,
        permission: PERMISSIONS.SALES_DASHBOARD_READ,
        exact: true,
      },
      {
        label: 'سفارش‌های فروش',
        href: ROUTES.salesOrders,
        icon: ShoppingBag,
        permission: PERMISSIONS.SALES_ORDERS_READ,
      },
      {
        label: 'مشتریان',
        href: ROUTES.salesCustomers,
        icon: Users,
        permission: PERMISSIONS.SALES_CUSTOMERS_READ,
      },
      {
        label: 'کانال‌های فروش',
        href: ROUTES.salesChannels,
        icon: Store,
        permission: PERMISSIONS.SALES_CHANNELS_READ,
      },
      {
        label: 'برگشت از مشتری',
        href: ROUTES.salesReturns,
        icon: RotateCcw,
        permission: PERMISSIONS.SALES_RETURNS_READ,
      },
    ],
  },
  {
    label: 'تسویه',
    items: [
      {
        label: 'نمای کلی تسویه',
        href: ROUTES.settlements,
        icon: LayoutDashboard,
        permission: PERMISSIONS.FINANCE_SETTLEMENTS_READ,
        exact: true,
      },
      {
        label: 'بدهی تأمین‌کننده',
        href: ROUTES.settlementPayables,
        icon: FileSpreadsheet,
        permission: PERMISSIONS.FINANCE_SETTLEMENTS_READ,
      },
      {
        label: 'وام‌ها',
        href: ROUTES.settlementLoans,
        icon: Landmark,
        permission: PERMISSIONS.FINANCE_SETTLEMENTS_READ,
      },
      {
        label: 'تسویه کانال',
        href: ROUTES.settlementChannels,
        icon: Store,
        permission: PERMISSIONS.FINANCE_SETTLEMENTS_READ,
      },
      {
        label: 'مغایرت‌گیری',
        href: ROUTES.settlementReconciliation,
        icon: ListChecks,
        permission: PERMISSIONS.FINANCE_RECONCILIATION_READ,
      },
      {
        label: 'تاریخچه تسویه',
        href: ROUTES.settlementAudit,
        icon: History,
        permission: PERMISSIONS.AUDIT_READ,
      },
    ],
  },
  {
    label: 'مالی',
    items: [
      {
        label: 'داشبورد مالی',
        href: ROUTES.finance,
        icon: LayoutGrid,
        permission: PERMISSIONS.FINANCE_DASHBOARD_READ,
        exact: true,
      },
      {
        label: 'حساب‌ها',
        href: ROUTES.financeAccounts,
        icon: WalletCards,
        permission: PERMISSIONS.FINANCE_ACCOUNTS_READ,
      },
      {
        label: 'حرکت پول',
        href: ROUTES.financeMoneyMovements,
        icon: ArrowLeftRight,
        permission: PERMISSIONS.FINANCE_PAYMENTS_READ,
      },
      {
        label: 'بدهی‌ها',
        href: ROUTES.financeLiabilities,
        icon: FileSpreadsheet,
        permission: PERMISSIONS.FINANCE_PAYABLES_READ,
      },
      {
        label: 'هزینه‌ها',
        href: ROUTES.financeExpenses,
        icon: ReceiptText,
        permission: PERMISSIONS.FINANCE_EXPENSES_READ,
      },
      {
        label: 'سرمایه و تأمین مالی',
        href: ROUTES.financeCapital,
        icon: Landmark,
        permission: PERMISSIONS.FINANCE_CAPITAL_READ,
      },
      {
        label: 'ارز / FX',
        href: ROUTES.financeFx,
        icon: CircleDollarSign,
        permission: PERMISSIONS.FINANCE_FX_READ,
      },
      {
        label: 'حسابداری',
        href: ROUTES.financeAccounting,
        icon: ScrollText,
        permission: PERMISSIONS.FINANCE_JOURNALS_READ,
      },
      {
        label: 'حسابرسی مالی',
        href: ROUTES.financeAudit,
        icon: History,
        permission: PERMISSIONS.FINANCE_AUDIT_READ,
      },
    ],
  },
  {
    label: 'کنترل',
    items: [
      {
        label: 'اشخاص',
        href: ROUTES.parties,
        icon: Users,
        permission: PERMISSIONS.PARTY_READ,
      },
      {
        label: 'تاریخچه تغییرات',
        href: ROUTES.audit,
        icon: ScrollText,
        permission: PERMISSIONS.AUDIT_READ,
      },
    ],
  },
  {
    label: 'سیستم',
    items: [
      {
        label: 'تنظیمات',
        href: ROUTES.settings,
        icon: Settings,
      },
    ],
  },
];

export function filterNavigation(
  groups: NavGroup[],
  hasPermission: (permission: PermissionKey | string) => boolean,
): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        if (!item.permission) return true;
        return hasPermission(item.permission);
      }),
    }))
    .filter((group) => group.items.length > 0);
}
