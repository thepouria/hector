'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AccessDenied,
  EmptyState,
  ErrorState,
  PageSkeleton,
  TableSkeleton,
} from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RowActionsMenu } from '@/components/ui/row-actions';
import { EntityHistory } from '@/features/catalog/entity-history';
import {
  activateSupplier,
  archiveSupplier,
  archiveSupplierContact,
  createSupplierContact,
  createSupplierNote,
  deactivateSupplier,
  fetchSupplier,
  fetchSupplierNotes,
  setPrimarySupplierContact,
  updateSupplier,
  updateSupplierContact,
} from '@/lib/api/hector';
import { isApiClientError } from '@/lib/api/errors';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { formatDateTime } from '@/lib/formatters';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { supplierKeys } from '@/lib/query/keys';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { SupplierContact } from '@/types/purchasing';

const textareaClassName =
  'flex min-h-[72px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm';

function statusLabel(status: string): string {
  if (status === 'ACTIVE') return 'فعال';
  if (status === 'INACTIVE') return 'غیرفعال';
  if (status === 'ARCHIVED') return 'بایگانی';
  return status;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-sm text-slate-900">{children}</div>
    </div>
  );
}

type LifecycleConfirm = 'deactivate' | 'activate' | 'archive' | null;

type ContactFormState = {
  name: string;
  role: string;
  phone: string;
  mobile: string;
  email: string;
  notes: string;
  isPrimary: boolean;
};

const emptyContactForm = (): ContactFormState => ({
  name: '',
  role: '',
  phone: '',
  mobile: '',
  email: '',
  notes: '',
  isPrimary: false,
});

export function SupplierDetailPageClient({ supplierId }: { supplierId: string }) {
  const router = useRouter();
  const { activeCompany, can, handleUnauthorized } = useSession();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? '';
  const canManage = can(PERMISSIONS.PURCHASING_MANAGE);

  const [editOpen, setEditOpen] = React.useState(false);
  const [name, setName] = React.useState('');
  const [legalName, setLegalName] = React.useState('');
  const [code, setCode] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [lifecycleConfirm, setLifecycleConfirm] = React.useState<LifecycleConfirm>(null);

  const [contactDialogOpen, setContactDialogOpen] = React.useState(false);
  const [editingContact, setEditingContact] = React.useState<SupplierContact | null>(null);
  const [contactForm, setContactForm] = React.useState<ContactFormState>(emptyContactForm);
  const [archiveContactTarget, setArchiveContactTarget] = React.useState<SupplierContact | null>(
    null,
  );

  const [noteBody, setNoteBody] = React.useState('');
  const [notesPage, setNotesPage] = React.useState(1);

  const detailQuery = useQuery({
    queryKey: supplierKeys.detail(companyId, supplierId),
    enabled: Boolean(companyId) && can(PERMISSIONS.PURCHASING_READ),
    queryFn: () => fetchSupplier(companyId, supplierId),
  });

  const notesFilters = { page: notesPage, pageSize: 20, sortBy: 'createdAt', sortOrder: 'desc' };
  const notesQuery = useQuery({
    queryKey: supplierKeys.notes(companyId, supplierId, notesFilters),
    enabled: Boolean(companyId) && can(PERMISSIONS.PURCHASING_READ),
    queryFn: () => fetchSupplierNotes(companyId, supplierId, notesFilters),
  });

  React.useEffect(() => {
    const err = detailQuery.error ?? notesQuery.error;
    if (err && isApiClientError(err) && err.status === 401) {
      handleUnauthorized();
    }
  }, [detailQuery.error, notesQuery.error, handleUnauthorized]);

  React.useEffect(() => {
    const supplier = detailQuery.data;
    if (!supplier) return;
    setName(supplier.name);
    setLegalName(supplier.legalName ?? '');
    setCode(supplier.code ?? '');
    setPhone(supplier.phone ?? '');
    setEmail(supplier.email ?? '');
    setAddress(supplier.address ?? '');
  }, [detailQuery.data]);

  const invalidateSupplier = async () => {
    await queryClient.invalidateQueries({ queryKey: supplierKeys.all(companyId) });
    await queryClient.invalidateQueries({ queryKey: supplierKeys.detail(companyId, supplierId) });
  };

  const invalidateNotes = async () => {
    await queryClient.invalidateQueries({
      queryKey: ['suppliers', companyId, supplierId, 'notes'],
    });
  };

  const updateMutation = useMutation({
    mutationFn: () =>
      updateSupplier(companyId, supplierId, {
        name: name.trim(),
        legalName: legalName.trim() ? legalName.trim() : null,
        code: code.trim() ? code.trim() : null,
        phone: phone.trim() ? phone.trim() : null,
        email: email.trim() ? email.trim() : null,
        address: address.trim() ? address.trim() : null,
      }),
    onSuccess: async () => {
      toast.success('تأمین‌کننده به‌روز شد.');
      setEditOpen(false);
      await invalidateSupplier();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const deactivateMutation = useMutation({
    mutationFn: () => deactivateSupplier(companyId, supplierId),
    onSuccess: async () => {
      toast.success('تأمین‌کننده غیرفعال شد.');
      setLifecycleConfirm(null);
      await invalidateSupplier();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const activateMutation = useMutation({
    mutationFn: () => activateSupplier(companyId, supplierId),
    onSuccess: async () => {
      toast.success('تأمین‌کننده فعال شد.');
      setLifecycleConfirm(null);
      await invalidateSupplier();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const archiveMutation = useMutation({
    mutationFn: () => archiveSupplier(companyId, supplierId),
    onSuccess: async () => {
      toast.success('تأمین‌کننده بایگانی شد.');
      setLifecycleConfirm(null);
      await invalidateSupplier();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const saveContactMutation = useMutation({
    mutationFn: () => {
      const payload = {
        name: contactForm.name.trim(),
        ...(contactForm.role.trim() ? { role: contactForm.role.trim() } : {}),
        ...(contactForm.phone.trim() ? { phone: contactForm.phone.trim() } : {}),
        ...(contactForm.mobile.trim() ? { mobile: contactForm.mobile.trim() } : {}),
        ...(contactForm.email.trim() ? { email: contactForm.email.trim() } : {}),
        ...(contactForm.notes.trim() ? { notes: contactForm.notes.trim() } : {}),
        ...(editingContact ? {} : { isPrimary: contactForm.isPrimary }),
      };
      if (editingContact) {
        return updateSupplierContact(companyId, supplierId, editingContact.id, {
          name: payload.name,
          role: contactForm.role.trim() ? contactForm.role.trim() : null,
          phone: contactForm.phone.trim() ? contactForm.phone.trim() : null,
          mobile: contactForm.mobile.trim() ? contactForm.mobile.trim() : null,
          email: contactForm.email.trim() ? contactForm.email.trim() : null,
          notes: contactForm.notes.trim() ? contactForm.notes.trim() : null,
        });
      }
      return createSupplierContact(companyId, supplierId, payload);
    },
    onSuccess: async () => {
      toast.success(editingContact ? 'مخاطب به‌روز شد.' : 'مخاطب اضافه شد.');
      setContactDialogOpen(false);
      setEditingContact(null);
      setContactForm(emptyContactForm());
      await invalidateSupplier();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const setPrimaryMutation = useMutation({
    mutationFn: (contactId: string) =>
      setPrimarySupplierContact(companyId, supplierId, contactId),
    onSuccess: async () => {
      toast.success('مخاطب اصلی تنظیم شد.');
      await invalidateSupplier();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const archiveContactMutation = useMutation({
    mutationFn: (contactId: string) =>
      archiveSupplierContact(companyId, supplierId, contactId),
    onSuccess: async () => {
      toast.success('مخاطب بایگانی شد.');
      setArchiveContactTarget(null);
      await invalidateSupplier();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const createNoteMutation = useMutation({
    mutationFn: () => createSupplierNote(companyId, supplierId, { body: noteBody.trim() }),
    onSuccess: async () => {
      toast.success('یادداشت ثبت شد.');
      setNoteBody('');
      setNotesPage(1);
      await invalidateNotes();
    },
    onError: (error) => toast.error(mapBusinessError(error)),
  });

  const openContactCreate = () => {
    setEditingContact(null);
    setContactForm(emptyContactForm());
    setContactDialogOpen(true);
  };

  const openContactEdit = (contact: SupplierContact) => {
    setEditingContact(contact);
    setContactForm({
      name: contact.name,
      role: contact.role ?? '',
      phone: contact.phone ?? '',
      mobile: contact.mobile ?? '',
      email: contact.email ?? '',
      notes: contact.notes ?? '',
      isPrimary: contact.isPrimary,
    });
    setContactDialogOpen(true);
  };

  if (!can(PERMISSIONS.PURCHASING_READ)) {
    return <AccessDenied />;
  }

  if (detailQuery.isLoading) {
    return <PageSkeleton />;
  }

  if (detailQuery.error) {
    if (isApiClientError(detailQuery.error) && detailQuery.error.status === 404) {
      return (
        <div className="space-y-4">
          <ErrorState
            title="تأمین‌کننده پیدا نشد"
            message="این تأمین‌کننده در شرکت فعال وجود ندارد."
          />
          <Button variant="outline" onClick={() => router.replace(ROUTES.purchasingSuppliers)}>
            بازگشت به فهرست
          </Button>
        </div>
      );
    }
    return (
      <ErrorState
        title="خطا در دریافت تأمین‌کننده"
        message={mapBusinessError(detailQuery.error)}
        onRetry={() => void detailQuery.refetch()}
      />
    );
  }

  const supplier = detailQuery.data!;
  const contacts = supplier.contacts ?? [];
  const notes = notesQuery.data?.data ?? [];
  const notesMeta = notesQuery.data?.meta;
  const notesTotalPages = notesMeta ? Math.max(1, Math.ceil(notesMeta.total / notesMeta.pageSize)) : 1;
  const lifecycleLoading =
    deactivateMutation.isPending || activateMutation.isPending || archiveMutation.isPending;

  return (
    <div className="space-y-6">
      <PageHeader
        title={supplier.name}
        description={supplier.code ? `کد: ${supplier.code}` : undefined}
        breadcrumbs={[
          { label: 'خرید', href: ROUTES.purchasing },
          { label: 'تأمین‌کنندگان', href: ROUTES.purchasingSuppliers },
          { label: supplier.name },
        ]}
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(true)}>
                ویرایش
              </Button>
              {supplier.status === 'ACTIVE' ? (
                <Button type="button" variant="outline" onClick={() => setLifecycleConfirm('deactivate')}>
                  غیرفعال کردن
                </Button>
              ) : null}
              {supplier.status === 'INACTIVE' || supplier.status === 'ARCHIVED' ? (
                <Button type="button" variant="outline" onClick={() => setLifecycleConfirm('activate')}>
                  فعال‌سازی
                </Button>
              ) : null}
              {supplier.status !== 'ARCHIVED' ? (
                <Button type="button" variant="outline" onClick={() => setLifecycleConfirm('archive')}>
                  بایگانی
                </Button>
              ) : null}
            </div>
          ) : null
        }
      />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">نمای کلی</h2>
        <div className="grid gap-4 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-2">
          <Field label="نام">{supplier.name}</Field>
          <Field label="نام حقوقی">{supplier.legalName ?? '—'}</Field>
          <Field label="کد">
            <span dir="ltr">{supplier.code ?? '—'}</span>
          </Field>
          <Field label="وضعیت">
            <Badge>{statusLabel(supplier.status)}</Badge>
          </Field>
          <Field label="تلفن">
            <span dir="ltr">{supplier.phone ?? '—'}</span>
          </Field>
          <Field label="ایمیل">
            <span dir="ltr">{supplier.email ?? '—'}</span>
          </Field>
          <Field label="ایجاد">{formatDateTime(supplier.createdAt)}</Field>
          <Field label="به‌روزرسانی">{formatDateTime(supplier.updatedAt)}</Field>
          <div className="sm:col-span-2">
            <Field label="آدرس">{supplier.address?.trim() ? supplier.address : '—'}</Field>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-900">مخاطبین</h2>
          {canManage ? (
            <Button type="button" size="sm" onClick={openContactCreate}>
              مخاطب جدید
            </Button>
          ) : null}
        </div>
        {contacts.length === 0 ? (
          <EmptyState
            title="مخاطبی ثبت نشده است"
            description="برای هماهنگی خرید، مخاطب تأمین‌کننده را اضافه کنید."
            action={
              canManage ? (
                <Button type="button" size="sm" onClick={openContactCreate}>
                  افزودن مخاطب
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-right text-slate-600">
                <tr>
                  <th className="px-4 py-3 font-medium">نام</th>
                  <th className="px-4 py-3 font-medium">نقش</th>
                  <th className="px-4 py-3 font-medium">تماس</th>
                  <th className="px-4 py-3 font-medium">اصلی</th>
                  {canManage ? <th className="px-4 py-3 font-medium">عملیات</th> : null}
                </tr>
              </thead>
              <tbody>
                {contacts.map((contact) => (
                  <tr key={contact.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 font-medium text-slate-900">{contact.name}</td>
                    <td className="px-4 py-3 text-slate-600">{contact.role ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">
                      <div dir="ltr" className="text-left">
                        {contact.mobile ?? contact.phone ?? '—'}
                      </div>
                      {contact.email ? (
                        <div dir="ltr" className="mt-0.5 text-left text-xs text-slate-500">
                          {contact.email}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      {contact.isPrimary ? <Badge>اصلی</Badge> : '—'}
                    </td>
                    {canManage ? (
                      <td className="px-4 py-3">
                        <RowActionsMenu
                          actions={[
                            { label: 'ویرایش', onSelect: () => openContactEdit(contact) },
                            ...(!contact.isPrimary
                              ? [
                                  {
                                    label: 'تنظیم به‌عنوان اصلی',
                                    onSelect: () => setPrimaryMutation.mutate(contact.id),
                                  },
                                ]
                              : []),
                            {
                              label: 'بایگانی',
                              onSelect: () => setArchiveContactTarget(contact),
                              danger: true,
                            },
                          ]}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">یادداشت‌ها</h2>
        {canManage ? (
          <form
            className="space-y-2 rounded-lg border border-slate-200 bg-white p-4"
            onSubmit={(event) => {
              event.preventDefault();
              createNoteMutation.mutate();
            }}
          >
            <Label htmlFor="supplier-note">یادداشت جدید</Label>
            <textarea
              id="supplier-note"
              className={textareaClassName}
              value={noteBody}
              onChange={(event) => setNoteBody(event.target.value)}
              maxLength={4000}
              placeholder="توضیحات داخلی درباره این تأمین‌کننده..."
            />
            <div className="flex justify-end">
              <Button type="submit" size="sm" disabled={createNoteMutation.isPending || !noteBody.trim()}>
                {createNoteMutation.isPending ? 'در حال ثبت...' : 'ثبت یادداشت'}
              </Button>
            </div>
          </form>
        ) : null}
        {notesQuery.isLoading ? <TableSkeleton rows={3} /> : null}
        {notesQuery.isError ? (
          <ErrorState
            title="خطا در دریافت یادداشت‌ها"
            message={mapBusinessError(notesQuery.error)}
            onRetry={() => void notesQuery.refetch()}
          />
        ) : null}
        {!notesQuery.isLoading && !notesQuery.isError && notes.length === 0 ? (
          <EmptyState title="یادداشتی ثبت نشده است." />
        ) : null}
        {notes.length > 0 ? (
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {notes.map((note) => (
              <li key={note.id} className="px-4 py-3 text-sm">
                <div className="whitespace-pre-wrap text-slate-900">{note.body}</div>
                <div className="mt-2 text-xs text-slate-500">
                  {note.author.displayName} · {formatDateTime(note.createdAt)}
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {notesMeta && notesMeta.total > notesMeta.pageSize ? (
          <div className="flex items-center justify-end gap-2 text-sm text-slate-600">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={notesPage <= 1}
              onClick={() => setNotesPage((p) => Math.max(1, p - 1))}
            >
              قبلی
            </Button>
            <span className="text-xs">
              {notesPage} / {notesTotalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={notesPage >= notesTotalPages}
              onClick={() => setNotesPage((p) => p + 1)}
            >
              بعدی
            </Button>
          </div>
        ) : null}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-slate-900">فعالیت</h2>
        <EntityHistory entityType="SUPPLIER" entityId={supplierId} />
      </section>

      <Link
        href={ROUTES.purchasingSuppliers}
        className="inline-flex text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        ← بازگشت به فهرست تأمین‌کنندگان
      </Link>

      <Dialog open={editOpen} onOpenChange={setEditOpen} title="ویرایش تأمین‌کننده">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            updateMutation.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="detail-supplier-name">نام</Label>
            <Input
              id="detail-supplier-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="detail-supplier-legal">نام حقوقی</Label>
            <Input
              id="detail-supplier-legal"
              value={legalName}
              onChange={(event) => setLegalName(event.target.value)}
              maxLength={200}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="detail-supplier-code">کد</Label>
            <Input
              id="detail-supplier-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={64}
              dir="ltr"
              className="text-left"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="detail-supplier-phone">تلفن</Label>
              <Input
                id="detail-supplier-phone"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                maxLength={64}
                dir="ltr"
                className="text-left"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="detail-supplier-email">ایمیل</Label>
              <Input
                id="detail-supplier-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                maxLength={254}
                dir="ltr"
                className="text-left"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="detail-supplier-address">آدرس</Label>
            <textarea
              id="detail-supplier-address"
              className={textareaClassName}
              value={address}
              onChange={(event) => setAddress(event.target.value)}
              maxLength={500}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
              انصراف
            </Button>
            <Button type="submit" disabled={updateMutation.isPending || !name.trim()}>
              {updateMutation.isPending ? 'در حال ذخیره...' : 'ذخیره'}
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={contactDialogOpen}
        onOpenChange={(open) => {
          setContactDialogOpen(open);
          if (!open) {
            setEditingContact(null);
            setContactForm(emptyContactForm());
          }
        }}
        title={editingContact ? 'ویرایش مخاطب' : 'مخاطب جدید'}
      >
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveContactMutation.mutate();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="contact-name">نام</Label>
            <Input
              id="contact-name"
              value={contactForm.name}
              onChange={(event) => setContactForm((f) => ({ ...f, name: event.target.value }))}
              required
              maxLength={120}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="contact-role">نقش (اختیاری)</Label>
            <Input
              id="contact-role"
              value={contactForm.role}
              onChange={(event) => setContactForm((f) => ({ ...f, role: event.target.value }))}
              maxLength={80}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="contact-phone">تلفن</Label>
              <Input
                id="contact-phone"
                value={contactForm.phone}
                onChange={(event) => setContactForm((f) => ({ ...f, phone: event.target.value }))}
                maxLength={64}
                dir="ltr"
                className="text-left"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="contact-mobile">موبایل</Label>
              <Input
                id="contact-mobile"
                value={contactForm.mobile}
                onChange={(event) => setContactForm((f) => ({ ...f, mobile: event.target.value }))}
                maxLength={64}
                dir="ltr"
                className="text-left"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="contact-email">ایمیل</Label>
            <Input
              id="contact-email"
              type="email"
              value={contactForm.email}
              onChange={(event) => setContactForm((f) => ({ ...f, email: event.target.value }))}
              maxLength={254}
              dir="ltr"
              className="text-left"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="contact-notes">یادداشت (اختیاری)</Label>
            <textarea
              id="contact-notes"
              className={textareaClassName}
              value={contactForm.notes}
              onChange={(event) => setContactForm((f) => ({ ...f, notes: event.target.value }))}
              maxLength={1000}
            />
          </div>
          {!editingContact ? (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={contactForm.isPrimary}
                onChange={(event) =>
                  setContactForm((f) => ({ ...f, isPrimary: event.target.checked }))
                }
              />
              مخاطب اصلی
            </label>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setContactDialogOpen(false)}>
              انصراف
            </Button>
            <Button
              type="submit"
              disabled={saveContactMutation.isPending || !contactForm.name.trim()}
            >
              {saveContactMutation.isPending ? 'در حال ذخیره...' : 'ذخیره'}
            </Button>
          </div>
        </form>
      </Dialog>

      <ConfirmDialog
        open={Boolean(lifecycleConfirm)}
        onOpenChange={(open) => {
          if (!open) setLifecycleConfirm(null);
        }}
        title={
          lifecycleConfirm === 'archive'
            ? 'بایگانی تأمین‌کننده'
            : lifecycleConfirm === 'deactivate'
              ? 'غیرفعال کردن تأمین‌کننده'
              : 'فعال‌سازی تأمین‌کننده'
        }
        description={
          lifecycleConfirm === 'archive'
            ? 'تأمین‌کننده حذف نمی‌شود و سوابق آن حفظ خواهد شد.'
            : lifecycleConfirm === 'deactivate'
              ? 'تأمین‌کننده تا زمان فعال‌سازی مجدد غیرفعال می‌ماند.'
              : 'تأمین‌کننده دوباره فعال می‌شود.'
        }
        target={supplier.name}
        confirmLabel={
          lifecycleConfirm === 'archive'
            ? 'بایگانی'
            : lifecycleConfirm === 'deactivate'
              ? 'غیرفعال کردن'
              : 'فعال‌سازی'
        }
        danger={lifecycleConfirm === 'archive' || lifecycleConfirm === 'deactivate'}
        loading={lifecycleLoading}
        onConfirm={() => {
          if (lifecycleConfirm === 'archive') archiveMutation.mutate();
          else if (lifecycleConfirm === 'deactivate') deactivateMutation.mutate();
          else if (lifecycleConfirm === 'activate') activateMutation.mutate();
        }}
      />

      <ConfirmDialog
        open={Boolean(archiveContactTarget)}
        onOpenChange={(open) => {
          if (!open) setArchiveContactTarget(null);
        }}
        title="بایگانی مخاطب"
        description="مخاطب حذف نمی‌شود و در صورت نیاز می‌توانید مخاطب جدید اضافه کنید."
        target={archiveContactTarget?.name}
        confirmLabel="بایگانی"
        danger
        loading={archiveContactMutation.isPending}
        onConfirm={() => {
          if (archiveContactTarget) archiveContactMutation.mutate(archiveContactTarget.id);
        }}
      />
    </div>
  );
}
