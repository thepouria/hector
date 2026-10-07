'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  PageSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EntityHistory } from '@/features/catalog/entity-history';
import {
  PARTY_ADDRESS_TYPE_LABELS,
  PARTY_CONTACT_TYPE_LABELS,
  PARTY_ROLE_LABELS,
  PARTY_STATUS_LABELS,
  PARTY_TYPE_LABELS,
} from '@/features/party/party-labels';
import {
  activateParty,
  addPartyAddress,
  addPartyContact,
  addPartyRole,
  archiveParty,
  archivePartyAddress,
  deactivateParty,
  deactivatePartyContact,
  deactivatePartyRole,
  fetchParty,
  fetchPartyRelatedEntities,
  setPartyAddressPrimary,
  setPartyContactPrimary,
  updateParty,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { partyKeys } from '@/lib/query/keys';
import {
  ROUTES,
  financeCapitalPath,
  financeLoanPath,
  partyPath,
  purchasingSupplierPath,
  salesCustomerPath,
} from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { PartyContactPointType, PartyRoleType } from '@/types/party';

type Tab = 'identity' | 'contacts' | 'addresses' | 'roles' | 'related' | 'activity';

const ROLE_OPTIONS: PartyRoleType[] = [
  'SUPPLIER',
  'CUSTOMER',
  'PARTNER',
  'LENDER',
  'BORROWER',
  'CONTACT',
  'EMPLOYEE',
  'OTHER',
];

export function PartyDetailPage({ partyId }: { partyId: string }) {
  const { activeCompany, can, handleUnauthorized } = useSession();
  const companyId = activeCompany?.id ?? '';
  const queryClient = useQueryClient();
  const canRead = can(PERMISSIONS.PARTY_READ);
  const canUpdate = can(PERMISSIONS.PARTY_UPDATE);
  const canStatus = can(PERMISSIONS.PARTY_STATUS);
  const canContacts = can(PERMISSIONS.PARTY_CONTACTS_MANAGE);
  const canAddresses = can(PERMISSIONS.PARTY_ADDRESSES_MANAGE);
  const canRoles = can(PERMISSIONS.PARTY_ROLES_MANAGE);

  const [tab, setTab] = React.useState<Tab>('identity');
  const [editOpen, setEditOpen] = React.useState(false);
  const [contactOpen, setContactOpen] = React.useState(false);
  const [addressOpen, setAddressOpen] = React.useState(false);
  const [roleOpen, setRoleOpen] = React.useState(false);
  const [statusAction, setStatusAction] = React.useState<'activate' | 'deactivate' | 'archive' | null>(
    null,
  );

  const [editDisplayName, setEditDisplayName] = React.useState('');
  const [editFirstName, setEditFirstName] = React.useState('');
  const [editLastName, setEditLastName] = React.useState('');
  const [editLegalName, setEditLegalName] = React.useState('');
  const [editTradeName, setEditTradeName] = React.useState('');
  const [editNotes, setEditNotes] = React.useState('');

  const [contactType, setContactType] = React.useState<PartyContactPointType>('MOBILE');
  const [contactValue, setContactValue] = React.useState('');
  const [contactPrimary, setContactPrimary] = React.useState(true);

  const [addressLine1, setAddressLine1] = React.useState('');
  const [addressCity, setAddressCity] = React.useState('');
  const [addressLabel, setAddressLabel] = React.useState('');
  const [addressPrimary, setAddressPrimary] = React.useState(true);

  const [newRole, setNewRole] = React.useState<PartyRoleType>('PARTNER');

  const query = useQuery({
    queryKey: partyKeys.detail(companyId, partyId),
    enabled: Boolean(companyId) && canRead,
    queryFn: () => fetchParty(companyId, partyId),
  });

  const relatedQuery = useQuery({
    queryKey: partyKeys.related(companyId, partyId),
    enabled: Boolean(companyId) && canRead && tab === 'related',
    queryFn: () => fetchPartyRelatedEntities(companyId, partyId),
  });

  React.useEffect(() => {
    if (query.error && isApiClientError(query.error) && query.error.status === 401) {
      handleUnauthorized();
    }
  }, [query.error, handleUnauthorized]);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: partyKeys.detail(companyId, partyId) });
    await queryClient.invalidateQueries({ queryKey: partyKeys.all(companyId) });
    await queryClient.invalidateQueries({ queryKey: partyKeys.related(companyId, partyId) });
  };

  const editMut = useMutation({
    mutationFn: () =>
      updateParty(companyId, partyId, {
        displayName: editDisplayName.trim() || undefined,
        firstName: editFirstName.trim() || null,
        lastName: editLastName.trim() || null,
        legalName: editLegalName.trim() || null,
        tradeName: editTradeName.trim() || null,
        notes: editNotes.trim() || null,
      }),
    onSuccess: async () => {
      toast.success('هویت به‌روز شد');
      setEditOpen(false);
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  const statusMut = useMutation({
    mutationFn: async () => {
      if (statusAction === 'activate') return activateParty(companyId, partyId);
      if (statusAction === 'deactivate') return deactivateParty(companyId, partyId);
      return archiveParty(companyId, partyId);
    },
    onSuccess: async () => {
      toast.success('وضعیت تغییر کرد');
      setStatusAction(null);
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  const contactMut = useMutation({
    mutationFn: () =>
      addPartyContact(companyId, partyId, {
        type: contactType,
        value: contactValue.trim(),
        isPrimary: contactPrimary,
      }),
    onSuccess: async () => {
      toast.success('تماس افزوده شد');
      setContactOpen(false);
      setContactValue('');
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  const addressMut = useMutation({
    mutationFn: () =>
      addPartyAddress(companyId, partyId, {
        addressLine1: addressLine1.trim(),
        city: addressCity.trim() || undefined,
        label: addressLabel.trim() || undefined,
        isPrimary: addressPrimary,
      }),
    onSuccess: async () => {
      toast.success('آدرس افزوده شد');
      setAddressOpen(false);
      setAddressLine1('');
      setAddressCity('');
      setAddressLabel('');
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  const roleMut = useMutation({
    mutationFn: () => addPartyRole(companyId, partyId, { roleType: newRole }),
    onSuccess: async () => {
      toast.success('نقش افزوده شد');
      setRoleOpen(false);
      await invalidate();
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  if (!canRead) {
    return <AccessDenied message="مجوز مشاهده شخص ندارید." />;
  }
  if (query.isLoading) return <PageSkeleton />;
  if (query.error) {
    return <ErrorState title="خطا" message={mapBusinessError(query.error)} />;
  }

  const p = query.data!;
  const activeRoles = p.roles.filter((r) => r.status === 'ACTIVE');

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'identity', label: 'هویت' },
    { id: 'contacts', label: 'تماس‌ها' },
    { id: 'addresses', label: 'آدرس‌ها' },
    { id: 'roles', label: 'نقش‌ها' },
    { id: 'related', label: 'موجودیت‌های مرتبط' },
    { id: 'activity', label: 'فعالیت' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={p.displayName}
        description={`${p.partyCode} · ${PARTY_TYPE_LABELS[p.type]} · ${PARTY_STATUS_LABELS[p.status]}`}
        breadcrumbs={[
          { label: 'اشخاص', href: ROUTES.parties },
          { label: p.displayName },
        ]}
        actions={
          <div className="flex flex-wrap gap-2">
            {canUpdate && p.status !== 'ARCHIVED' ? (
              <Button
                variant="outline"
                onClick={() => {
                  setEditDisplayName(p.displayName);
                  setEditFirstName(p.firstName ?? '');
                  setEditLastName(p.lastName ?? '');
                  setEditLegalName(p.legalName ?? '');
                  setEditTradeName(p.tradeName ?? '');
                  setEditNotes(p.notes ?? '');
                  setEditOpen(true);
                }}
              >
                ویرایش
              </Button>
            ) : null}
            {canRoles ? (
              <Button variant="outline" onClick={() => setRoleOpen(true)}>
                مدیریت نقش
              </Button>
            ) : null}
            {canStatus && p.status !== 'ACTIVE' ? (
              <Button variant="outline" onClick={() => setStatusAction('activate')}>
                فعال‌سازی
              </Button>
            ) : null}
            {canStatus && p.status === 'ACTIVE' ? (
              <Button variant="outline" onClick={() => setStatusAction('deactivate')}>
                غیرفعال‌سازی
              </Button>
            ) : null}
            {canStatus && p.status !== 'ARCHIVED' ? (
              <Button variant="outline" onClick={() => setStatusAction('archive')}>
                بایگانی
              </Button>
            ) : null}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs" dir="ltr">{p.partyCode}</span>
        <Badge>{PARTY_TYPE_LABELS[p.type]}</Badge>
        <Badge>{PARTY_STATUS_LABELS[p.status]}</Badge>
        {activeRoles.map((r) => (
          <Badge key={r.id}>{PARTY_ROLE_LABELS[r.roleType]}</Badge>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        {tabs.map((t) => (
          <Button
            key={t.id}
            size="sm"
            variant={tab === t.id ? 'default' : 'ghost'}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {tab === 'identity' ? (
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 text-sm md:grid-cols-2">
          {p.type === 'INDIVIDUAL' ? (
            <>
              <div>نام: {p.firstName ?? '—'}</div>
              <div>نام خانوادگی: {p.lastName ?? '—'}</div>
              <div>
                کد ملی:{' '}
                <span dir="ltr">{p.nationalId ?? '—'}</span>
              </div>
              <div>تاریخ تولد: {p.birthDate ?? '—'}</div>
            </>
          ) : (
            <>
              <div>نام حقوقی: {p.legalName ?? '—'}</div>
              <div>نام تجاری: {p.tradeName ?? '—'}</div>
              <div>
                شماره ثبت:{' '}
                <span dir="ltr">{p.registrationNumber ?? '—'}</span>
              </div>
              <div>
                شناسه مالیاتی:{' '}
                <span dir="ltr">{p.taxId ?? '—'}</span>
              </div>
            </>
          )}
          <div className="md:col-span-2">یادداشت: {p.notes ?? '—'}</div>
          <div>ایجاد: {formatDateTime(p.createdAt)}</div>
          <div>به‌روزرسانی: {formatDateTime(p.updatedAt)}</div>
        </div>
      ) : null}

      {tab === 'contacts' ? (
        <section className="space-y-3">
          {canContacts ? (
            <Button size="sm" onClick={() => setContactOpen(true)}>
              افزودن تماس
            </Button>
          ) : null}
          {p.contacts.filter((c) => c.status === 'ACTIVE').length === 0 ? (
            <EmptyState title="تماسی ثبت نشده" />
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {p.contacts
                .filter((c) => c.status === 'ACTIVE')
                .map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                    <div>
                      <div className="font-medium">
                        {PARTY_CONTACT_TYPE_LABELS[c.type]}
                        {c.isPrimary ? (
                          <Badge className="ms-2">
                            اصلی
                          </Badge>
                        ) : null}
                      </div>
                      <div dir="ltr">{c.value}</div>
                      {c.label ? <div className="text-slate-500">{c.label}</div> : null}
                    </div>
                    {canContacts ? (
                      <div className="flex gap-2">
                        {!c.isPrimary ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              void setPartyContactPrimary(companyId, partyId, c.id)
                                .then(invalidate)
                                .then(() => toast.success('تماس اصلی تنظیم شد'))
                                .catch((e) => toast.error(mapBusinessError(e)))
                            }
                          >
                            اصلی
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            void deactivatePartyContact(companyId, partyId, c.id)
                              .then(invalidate)
                              .then(() => toast.success('تماس غیرفعال شد'))
                              .catch((e) => toast.error(mapBusinessError(e)))
                          }
                        >
                          غیرفعال
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === 'addresses' ? (
        <section className="space-y-3">
          {canAddresses ? (
            <Button size="sm" onClick={() => setAddressOpen(true)}>
              افزودن آدرس
            </Button>
          ) : null}
          {p.addresses.length === 0 ? (
            <EmptyState title="آدرسی ثبت نشده" />
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {p.addresses.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
                  <div>
                    <div className="font-medium">
                      {a.label || PARTY_ADDRESS_TYPE_LABELS[a.type]}
                      {a.isPrimary ? (
                        <Badge className="ms-2">
                          اصلی
                        </Badge>
                      ) : null}
                    </div>
                    <div>{a.addressLine1}</div>
                    <div className="text-slate-600">
                      {[a.city, a.province, a.country].filter(Boolean).join('، ') || '—'}
                    </div>
                  </div>
                  {canAddresses ? (
                    <div className="flex gap-2">
                      {!a.isPrimary ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            void setPartyAddressPrimary(companyId, partyId, a.id)
                              .then(invalidate)
                              .then(() => toast.success('آدرس اصلی تنظیم شد'))
                              .catch((e) => toast.error(mapBusinessError(e)))
                          }
                        >
                          اصلی
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          void archivePartyAddress(companyId, partyId, a.id)
                            .then(invalidate)
                            .then(() => toast.success('آدرس بایگانی شد'))
                            .catch((e) => toast.error(mapBusinessError(e)))
                        }
                      >
                        بایگانی
                      </Button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === 'roles' ? (
        <section className="space-y-3">
          <p className="text-sm text-slate-600">
            نقش‌ها ظرفیت کسب‌وکاری هستند؛ موجودیت دامنه (تأمین‌کننده، مشتری، وام…) منبع حقیقت عملیاتی است.
          </p>
          {canRoles ? (
            <Button size="sm" onClick={() => setRoleOpen(true)}>
              افزودن نقش
            </Button>
          ) : null}
          {p.roles.length === 0 ? (
            <EmptyState title="نقشی ثبت نشده" />
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
              {p.roles.map((r) => (
                <li key={r.id} className="flex items-center justify-between px-4 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge>{PARTY_ROLE_LABELS[r.roleType]}</Badge>
                    <Badge>
                      {r.status === 'ACTIVE' ? 'فعال' : 'غیرفعال'}
                    </Badge>
                  </div>
                  {canRoles && r.status === 'ACTIVE' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        void deactivatePartyRole(companyId, partyId, r.id)
                          .then(invalidate)
                          .then(() => toast.success('نقش غیرفعال شد'))
                          .catch((e) => toast.error(mapBusinessError(e)))
                      }
                    >
                      غیرفعال‌سازی
                    </Button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {tab === 'related' ? (
        <section className="space-y-4">
          {relatedQuery.isLoading ? <PageSkeleton /> : null}
          {relatedQuery.error ? (
            <ErrorState title="خطا" message={mapBusinessError(relatedQuery.error)} />
          ) : null}
          {relatedQuery.data ? (
            <>
              {relatedQuery.data.omitted.purchasing &&
              relatedQuery.data.omitted.sales &&
              relatedQuery.data.omitted.finance &&
              relatedQuery.data.contactRelationships.length === 0 ? (
                <EmptyState title="دسترسی دامنه ندارید یا رابطه‌ای نیست" />
              ) : null}

              {!relatedQuery.data.omitted.purchasing ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h3 className="mb-2 font-medium">خرید</h3>
                  {relatedQuery.data.supplier ? (
                    <div className="text-sm">
                      <Link
                        href={purchasingSupplierPath(relatedQuery.data.supplier.id)}
                        className="text-sky-700 hover:underline"
                      >
                        تأمین‌کننده {relatedQuery.data.supplier.code ?? relatedQuery.data.supplier.id.slice(0, 8)}
                      </Link>
                      <span className="ms-2 text-slate-500">
                        ({relatedQuery.data.supplier.status}) ·{' '}
                        {relatedQuery.data.supplier.openPurchaseOrderCount} سفارش باز
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">تأمین‌کننده‌ای لینک نشده</p>
                  )}
                  {relatedQuery.data.partner ? (
                    <div className="mt-2 text-sm">
                      شریک · {relatedQuery.data.partner.status}
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-slate-500">خرید مخفی — مجوز purchasing.read ندارید.</p>
              )}

              {!relatedQuery.data.omitted.sales ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h3 className="mb-2 font-medium">فروش</h3>
                  {relatedQuery.data.customer ? (
                    <div className="text-sm">
                      <Link
                        href={salesCustomerPath(relatedQuery.data.customer.id)}
                        className="text-sky-700 hover:underline"
                      >
                        مشتری {relatedQuery.data.customer.code ?? relatedQuery.data.customer.id.slice(0, 8)}
                      </Link>
                      <span className="ms-2 text-slate-500">
                        ({relatedQuery.data.customer.status}) ·{' '}
                        {relatedQuery.data.customer.openSalesOrderCount} سفارش باز
                      </span>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">مشتری‌ای لینک نشده</p>
                  )}
                </div>
              ) : (
                <p className="text-sm text-slate-500">فروش مخفی — مجوز sales.customers.read ندارید.</p>
              )}

              {!relatedQuery.data.omitted.finance ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-2">
                  <h3 className="font-medium">مالی</h3>
                  {relatedQuery.data.loansAsLender.length === 0 &&
                  relatedQuery.data.loansAsBorrower.length === 0 &&
                  relatedQuery.data.capitalContributions.length === 0 ? (
                    <p className="text-sm text-slate-500">رابطه مالی ثبت نشده</p>
                  ) : null}
                  {relatedQuery.data.loansAsLender.map((l) => (
                    <div key={l.id} className="text-sm">
                      <Link href={financeLoanPath(l.id)} className="text-sky-700 hover:underline">
                        وام (وام‌دهنده) {l.number}
                      </Link>
                      <span className="ms-2" dir="ltr">
                        {l.currency} {l.contractedPrincipal} · {l.status}
                      </span>
                    </div>
                  ))}
                  {relatedQuery.data.loansAsBorrower.map((l) => (
                    <div key={l.id} className="text-sm">
                      <Link href={financeLoanPath(l.id)} className="text-sky-700 hover:underline">
                        وام (وام‌گیرنده) {l.number}
                      </Link>
                      <span className="ms-2" dir="ltr">
                        {l.currency} {l.contractedPrincipal} · {l.status}
                      </span>
                    </div>
                  ))}
                  {relatedQuery.data.capitalContributions.map((c) => (
                    <div key={c.id} className="text-sm">
                      <Link href={financeCapitalPath(c.id)} className="text-sky-700 hover:underline">
                        سرمایه {c.number}
                      </Link>
                      <span className="ms-2" dir="ltr">
                        {c.currency} {c.amount} · {c.status}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-slate-500">مالی مخفی — مجوز مالی ندارید.</p>
              )}

              {relatedQuery.data.contactRelationships.length > 0 ? (
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <h3 className="mb-2 font-medium">روابط مخاطب</h3>
                  {relatedQuery.data.contactRelationships.map((rel) => (
                    <div key={rel.relationshipId} className="text-sm">
                      <Link
                        href={partyPath(rel.relatedPartyId)}
                        className="text-sky-700 hover:underline"
                      >
                        {rel.relatedDisplayName}
                      </Link>
                      <span className="ms-2 font-mono text-xs" dir="ltr">
                        {rel.relatedPartyCode}
                      </span>
                      <span className="ms-2 text-slate-500">{rel.type}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {tab === 'activity' ? (
        <EntityHistory entityType="PARTY" entityId={partyId} />
      ) : null}

      <Dialog open={editOpen} onOpenChange={setEditOpen} title="ویرایش هویت">
        <div className="space-y-3">
          <div>
            <Label>نام نمایشی</Label>
            <Input value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} />
          </div>
          {p.type === 'INDIVIDUAL' ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>نام</Label>
                <Input value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} />
              </div>
              <div>
                <Label>نام خانوادگی</Label>
                <Input value={editLastName} onChange={(e) => setEditLastName(e.target.value)} />
              </div>
            </div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <div>
                <Label>نام حقوقی</Label>
                <Input value={editLegalName} onChange={(e) => setEditLegalName(e.target.value)} />
              </div>
              <div>
                <Label>نام تجاری</Label>
                <Input value={editTradeName} onChange={(e) => setEditTradeName(e.target.value)} />
              </div>
            </div>
          )}
          <div>
            <Label>یادداشت</Label>
            <textarea
              className="mt-1 min-h-16 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
            />
          </div>
          <Button disabled={editMut.isPending} onClick={() => editMut.mutate()}>
            ذخیره
          </Button>
        </div>
      </Dialog>

      <Dialog open={contactOpen} onOpenChange={setContactOpen} title="تماس جدید">
        <div className="space-y-3">
          <div>
            <Label>نوع</Label>
            <select
              className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
              value={contactType}
              onChange={(e) => setContactType(e.target.value as PartyContactPointType)}
            >
              {(['MOBILE', 'PHONE', 'EMAIL'] as PartyContactPointType[]).map((t) => (
                <option key={t} value={t}>
                  {PARTY_CONTACT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label>مقدار</Label>
            <Input
              value={contactValue}
              onChange={(e) => setContactValue(e.target.value)}
              dir="ltr"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={contactPrimary}
              onChange={(e) => setContactPrimary(e.target.checked)}
            />
            اصلی
          </label>
          <Button disabled={contactMut.isPending || !contactValue.trim()} onClick={() => contactMut.mutate()}>
            افزودن
          </Button>
        </div>
      </Dialog>

      <Dialog open={addressOpen} onOpenChange={setAddressOpen} title="آدرس جدید">
        <div className="space-y-3">
          <div>
            <Label>برچسب</Label>
            <Input value={addressLabel} onChange={(e) => setAddressLabel(e.target.value)} />
          </div>
          <div>
            <Label>آدرس</Label>
            <Input value={addressLine1} onChange={(e) => setAddressLine1(e.target.value)} />
          </div>
          <div>
            <Label>شهر</Label>
            <Input value={addressCity} onChange={(e) => setAddressCity(e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={addressPrimary}
              onChange={(e) => setAddressPrimary(e.target.checked)}
            />
            اصلی
          </label>
          <Button
            disabled={addressMut.isPending || !addressLine1.trim()}
            onClick={() => addressMut.mutate()}
          >
            افزودن
          </Button>
        </div>
      </Dialog>

      <Dialog open={roleOpen} onOpenChange={setRoleOpen} title="افزودن نقش">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            افزودن نقش، موجودیت دامنه (مثلاً تأمین‌کننده) نمی‌سازد. برای آن از جریان دامنه استفاده کنید.
          </p>
          <select
            className="w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as PartyRoleType)}
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r} value={r}>
                {PARTY_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
          <Button disabled={roleMut.isPending} onClick={() => roleMut.mutate()}>
            افزودن ظرفیت نقش
          </Button>
        </div>
      </Dialog>

      <ConfirmDialog
        open={statusAction !== null}
        onOpenChange={(open) => { if (!open) setStatusAction(null); }}
        title={
          statusAction === 'archive'
            ? 'بایگانی شخص؟'
            : statusAction === 'deactivate'
              ? 'غیرفعال‌سازی؟'
              : 'فعال‌سازی؟'
        }
        description={
          statusAction === 'archive'
            ? 'در صورت وجود رابطه فعال دامنه، سرور عملیات را رد می‌کند.'
            : 'وضعیت شخص تغییر می‌کند؛ تاریخچه حفظ می‌شود.'
        }
        confirmLabel="تأیید"
        onConfirm={() => statusMut.mutate()}
        loading={statusMut.isPending}
      />
    </div>
  );
}
