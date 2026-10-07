import type {
  PartyRoleType,
  PartyStatus,
  PartyType,
  PartyContactPointType,
  PartyAddressType,
} from '@/types/party';

export const PARTY_TYPE_LABELS: Record<PartyType, string> = {
  INDIVIDUAL: 'حقیقی',
  ORGANIZATION: 'حقوقی',
};

export const PARTY_STATUS_LABELS: Record<PartyStatus, string> = {
  ACTIVE: 'فعال',
  INACTIVE: 'غیرفعال',
  ARCHIVED: 'بایگانی',
};

export const PARTY_ROLE_LABELS: Record<PartyRoleType, string> = {
  SUPPLIER: 'تأمین‌کننده',
  CUSTOMER: 'مشتری',
  PARTNER: 'شریک',
  LENDER: 'وام‌دهنده',
  BORROWER: 'وام‌گیرنده',
  CONTACT: 'مخاطب',
  EMPLOYEE: 'کارمند',
  OTHER: 'سایر',
};

export const PARTY_CONTACT_TYPE_LABELS: Record<PartyContactPointType, string> = {
  MOBILE: 'موبایل',
  PHONE: 'تلفن',
  EMAIL: 'ایمیل',
  FAX: 'فکس',
  OTHER: 'سایر',
};

export const PARTY_ADDRESS_TYPE_LABELS: Record<PartyAddressType, string> = {
  GENERAL: 'عمومی',
  BILLING: 'صورتحساب',
  SHIPPING: 'ارسال',
  HOME: 'منزل',
  OFFICE: 'دفتر',
  WAREHOUSE: 'انبار',
  OTHER: 'سایر',
};

export const DUPLICATE_STRENGTH_LABELS: Record<string, string> = {
  EXACT: 'تطابق قطعی',
  STRONG: 'تطابق قوی',
  POTENTIAL: 'احتمال تکراری',
};
