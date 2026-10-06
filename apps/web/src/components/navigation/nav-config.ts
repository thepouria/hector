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
  HandCoins,
  FileSpreadsheet,
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
        label: 'فروش',
        href: ROUTES.sales,
        icon: ShoppingBag,
        placeholder: true,
      },
    ],
  },
  {
    label: 'مالی',
    items: [
      {
        label: 'حساب‌ها',
        href: ROUTES.financeAccounts,
        icon: WalletCards,
        permission: PERMISSIONS.FINANCE_ACCOUNTS_READ,
      },
      {
        label: 'سرمایه',
        href: ROUTES.financeCapital,
        icon: Landmark,
        permission: PERMISSIONS.FINANCE_CAPITAL_READ,
      },
      {
        label: 'وام‌ها',
        href: ROUTES.financeLoans,
        icon: HandCoins,
        permission: PERMISSIONS.FINANCE_LOANS_READ,
      },
      {
        label: 'حساب‌های پرداختنی',
        href: ROUTES.financePayables,
        icon: FileSpreadsheet,
        permission: PERMISSIONS.FINANCE_PAYABLES_READ,
      },
      {
        label: 'ارز / FX',
        href: ROUTES.financeFx,
        icon: CircleDollarSign,
        permission: PERMISSIONS.FINANCE_FX_READ,
      },
      {
        label: 'پرداخت‌ها',
        href: ROUTES.financePayments,
        icon: ArrowDownToLine,
        permission: PERMISSIONS.FINANCE_PAYMENTS_READ,
      },
      {
        label: 'دریافت‌ها',
        href: ROUTES.financeReceipts,
        icon: PackagePlus,
        permission: PERMISSIONS.FINANCE_RECEIPTS_READ,
      },
      {
        label: 'انتقال‌ها',
        href: ROUTES.financeAccountTransfers,
        icon: ArrowLeftRight,
        permission: PERMISSIONS.FINANCE_TRANSFERS_READ,
      },
      {
        label: 'تسویه‌ها',
        href: ROUTES.settlements,
        icon: ReceiptText,
        placeholder: true,
      },
    ],
  },
  {
    label: 'کنترل',
    items: [
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
