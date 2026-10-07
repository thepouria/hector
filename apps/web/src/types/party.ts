export type PartyType = 'INDIVIDUAL' | 'ORGANIZATION';
export type PartyStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type PartyRoleType =
  | 'SUPPLIER'
  | 'CUSTOMER'
  | 'PARTNER'
  | 'LENDER'
  | 'BORROWER'
  | 'CONTACT'
  | 'EMPLOYEE'
  | 'OTHER';
export type PartyContactPointType = 'MOBILE' | 'PHONE' | 'EMAIL' | 'FAX' | 'OTHER';
export type PartyContactPointStatus = 'ACTIVE' | 'INACTIVE';
export type PartyAddressType =
  | 'GENERAL'
  | 'BILLING'
  | 'SHIPPING'
  | 'HOME'
  | 'OFFICE'
  | 'WAREHOUSE'
  | 'OTHER';
export type PartyRoleStatus = 'ACTIVE' | 'INACTIVE';
export type DuplicateMatchStrength = 'EXACT' | 'STRONG' | 'POTENTIAL';

export type PartyListItem = {
  id: string;
  companyId: string;
  partyCode: string;
  type: PartyType;
  status: PartyStatus;
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  birthDate: string | null;
  legalName: string | null;
  tradeName: string | null;
  nationalId: string | null;
  registrationNumber: string | null;
  taxId: string | null;
  notes: string | null;
  primaryMobile: string | null;
  primaryEmail: string | null;
  roles: PartyRoleType[];
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type PartyContact = {
  id: string;
  companyId: string;
  partyId: string;
  type: PartyContactPointType;
  value: string;
  label: string | null;
  isPrimary: boolean;
  status: PartyContactPointStatus;
  createdAt: string;
  updatedAt: string;
};

export type PartyAddress = {
  id: string;
  companyId: string;
  partyId: string;
  label: string | null;
  type: PartyAddressType;
  country: string | null;
  province: string | null;
  city: string | null;
  district: string | null;
  postalCode: string | null;
  addressLine1: string;
  addressLine2: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  isPrimary: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
};

export type PartyRole = {
  id: string;
  companyId: string;
  partyId: string;
  roleType: PartyRoleType;
  status: PartyRoleStatus;
  startedAt: string;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type PartyDetail = Omit<PartyListItem, 'primaryMobile' | 'primaryEmail' | 'roles'> & {
  contacts: PartyContact[];
  addresses: PartyAddress[];
  roles: PartyRole[];
};

export type PartyDuplicateMatch = {
  partyId: string;
  partyCode: string;
  displayName: string;
  type: PartyType;
  status: PartyStatus;
  matchStrength: DuplicateMatchStrength;
  matchedOn: Array<'nationalId' | 'registrationNumber' | 'mobile' | 'email' | 'phone'>;
  reasonCodes: string[];
  roles: PartyRoleType[];
};

export type PartyRelatedEntities = {
  supplier: {
    id: string;
    code: string | null;
    status: string;
    openPurchaseOrderCount: number;
  } | null;
  customer: {
    id: string;
    code: string | null;
    status: string;
    openSalesOrderCount: number;
  } | null;
  partner: {
    id: string;
    status: string;
  } | null;
  loansAsLender: Array<{
    id: string;
    number: string;
    currency: string;
    status: string;
    contractedPrincipal: string;
  }>;
  loansAsBorrower: Array<{
    id: string;
    number: string;
    currency: string;
    status: string;
    contractedPrincipal: string;
  }>;
  capitalContributions: Array<{
    id: string;
    number: string;
    currency: string;
    status: string;
    amount: string;
  }>;
  contactRelationships: Array<{
    relationshipId: string;
    direction: 'FROM' | 'TO';
    relatedPartyId: string;
    relatedPartyCode: string;
    relatedDisplayName: string;
    type: string;
    status: string;
  }>;
  omitted: {
    purchasing: boolean;
    sales: boolean;
    finance: boolean;
  };
};
