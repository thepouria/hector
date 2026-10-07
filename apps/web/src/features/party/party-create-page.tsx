'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccessDenied, EmptyState } from '@/components/feedback/states';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  DUPLICATE_STRENGTH_LABELS,
  PARTY_ROLE_LABELS,
  PARTY_TYPE_LABELS,
} from '@/features/party/party-labels';
import { checkPartyDuplicates, createParty } from '@/lib/api/hector';
import { mapBusinessError } from '@/lib/errors/business-errors';
import { PERMISSIONS } from '@/lib/permissions/keys';
import { cn } from '@/lib/utils/cn';
import { ROUTES, partyPath } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';
import type { PartyDuplicateMatch, PartyType } from '@/types/party';

export function PartyCreatePage() {
  const router = useRouter();
  const { activeCompany, can } = useSession();
  const companyId = activeCompany?.id ?? '';
  const canCreate = can(PERMISSIONS.PARTY_CREATE);

  const [type, setType] = React.useState<PartyType>('INDIVIDUAL');
  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [legalName, setLegalName] = React.useState('');
  const [tradeName, setTradeName] = React.useState('');
  const [nationalId, setNationalId] = React.useState('');
  const [registrationNumber, setRegistrationNumber] = React.useState('');
  const [taxId, setTaxId] = React.useState('');
  const [mobile, setMobile] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [notes, setNotes] = React.useState('');
  const [duplicates, setDuplicates] = React.useState<PartyDuplicateMatch[]>([]);
  const [ackDuplicates, setAckDuplicates] = React.useState(false);

  const createMut = useMutation({
    mutationFn: async () => {
      const contacts = [];
      if (mobile.trim()) {
        contacts.push({ type: 'MOBILE', value: mobile.trim(), isPrimary: true });
      }
      if (email.trim()) {
        contacts.push({ type: 'EMAIL', value: email.trim(), isPrimary: true });
      }
      return createParty(companyId, {
        type,
        firstName: type === 'INDIVIDUAL' ? firstName.trim() || undefined : undefined,
        lastName: type === 'INDIVIDUAL' ? lastName.trim() || undefined : undefined,
        displayName: displayName.trim() || undefined,
        legalName: type === 'ORGANIZATION' ? legalName.trim() || undefined : undefined,
        tradeName: type === 'ORGANIZATION' ? tradeName.trim() || undefined : undefined,
        nationalId: nationalId.trim() || undefined,
        registrationNumber: registrationNumber.trim() || undefined,
        taxId: taxId.trim() || undefined,
        notes: notes.trim() || undefined,
        contacts: contacts.length ? contacts : undefined,
      });
    },
    onSuccess: (party) => {
      toast.success('شخص ایجاد شد');
      router.push(partyPath(party.id));
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  const checkMut = useMutation({
    mutationFn: () =>
      checkPartyDuplicates(companyId, {
        type,
        displayName:
          displayName.trim() ||
          [firstName, lastName].filter(Boolean).join(' ') ||
          legalName.trim() ||
          undefined,
        nationalId: nationalId.trim() || undefined,
        registrationNumber: registrationNumber.trim() || undefined,
        mobile: mobile.trim() || undefined,
        email: email.trim() || undefined,
      }),
    onSuccess: (matches) => {
      setDuplicates(matches);
      setAckDuplicates(false);
      if (matches.length === 0) {
        createMut.mutate();
      }
    },
    onError: (e) => toast.error(mapBusinessError(e)),
  });

  if (!canCreate) {
    return <AccessDenied message="برای ایجاد شخص به مجوز party.create نیاز است." />;
  }

  const hasStrong = duplicates.some(
    (d) => d.matchStrength === 'EXACT' || d.matchStrength === 'STRONG',
  );

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        title="شخص جدید"
        description="هویت canonical — نقش‌های عملیاتی در دامنه‌های مربوط ساخته می‌شوند"
        breadcrumbs={[
          { label: 'اشخاص', href: ROUTES.parties },
          { label: 'جدید' },
        ]}
      />

      <div className="space-y-4 rounded-lg border border-slate-200 bg-white p-4">
        <div>
          <Label>نوع شخص</Label>
          <div className="mt-2 flex gap-2">
            {(['INDIVIDUAL', 'ORGANIZATION'] as PartyType[]).map((t) => (
              <Button
                key={t}
                type="button"
                variant={type === t ? 'default' : 'outline'}
                onClick={() => setType(t)}
              >
                {PARTY_TYPE_LABELS[t]}
              </Button>
            ))}
          </div>
        </div>

        {type === 'INDIVIDUAL' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="firstName">نام</Label>
              <Input id="firstName" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="lastName">نام خانوادگی</Label>
              <Input id="lastName" value={lastName} onChange={(e) => setLastName(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="displayName">نام نمایشی (اختیاری)</Label>
              <Input
                id="displayName"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="nationalId">کد ملی (اختیاری)</Label>
              <Input
                id="nationalId"
                value={nationalId}
                onChange={(e) => setNationalId(e.target.value)}
                dir="ltr"
              />
            </div>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="legalName">نام حقوقی</Label>
              <Input id="legalName" value={legalName} onChange={(e) => setLegalName(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="tradeName">نام تجاری / نمایشی</Label>
              <Input id="tradeName" value={tradeName} onChange={(e) => setTradeName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="registrationNumber">شماره ثبت (اختیاری)</Label>
              <Input
                id="registrationNumber"
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                dir="ltr"
              />
            </div>
            <div>
              <Label htmlFor="taxId">شناسه مالیاتی (اختیاری)</Label>
              <Input id="taxId" value={taxId} onChange={(e) => setTaxId(e.target.value)} dir="ltr" />
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="mobile">موبایل</Label>
            <Input
              id="mobile"
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              dir="ltr"
              inputMode="tel"
              placeholder="0912…"
            />
          </div>
          <div>
            <Label htmlFor="email">ایمیل</Label>
            <Input
              id="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              dir="ltr"
              type="email"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="notes">یادداشت</Label>
          <textarea
            id="notes"
            className="mt-1 min-h-20 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        {duplicates.length > 0 ? (
          <div className="space-y-2 rounded-md border border-amber-200 bg-amber-50 p-3">
            <div className="font-medium text-amber-900">شخص‌های مشابه یافت شد</div>
            <p className="text-sm text-amber-800">
              ادغام خودکار انجام نمی‌شود. در صورت اطمینان می‌توانید ادامه دهید
              {hasStrong ? ' — مگر اینکه شناسه یکتا تکراری باشد (سرور رد می‌کند).' : '.'}
            </p>
            <ul className="space-y-2">
              {duplicates.map((d) => (
                <li
                  key={d.partyId}
                  className="rounded border border-amber-100 bg-white px-3 py-2 text-sm"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={partyPath(d.partyId)} className="font-medium text-sky-700 hover:underline">
                      {d.displayName}
                    </Link>
                    <span className="font-mono text-xs" dir="ltr">
                      {d.partyCode}
                    </span>
                    <Badge>{DUPLICATE_STRENGTH_LABELS[d.matchStrength]}</Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {d.roles.map((r) => (
                      <Badge key={r} className="bg-sky-50 text-sky-800">
                        {PARTY_ROLE_LABELS[r]}
                      </Badge>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
            {!hasStrong ? (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={ackDuplicates}
                  onChange={(e) => setAckDuplicates(e.target.checked)}
                />
                این شخص متفاوت است؛ ادامه ایجاد
              </label>
            ) : (
              <EmptyState
                title="تطابق شناسه قوی"
                description="ایجاد با همین شناسه ملی / شماره ثبت ممکن نیست. شخص موجود را باز کنید."
              />
            )}
          </div>
        ) : null}

        <div className="flex gap-2">
          <Button
            disabled={
              checkMut.isPending ||
              createMut.isPending ||
              (duplicates.length > 0 && !hasStrong && !ackDuplicates) ||
              hasStrong
            }
            onClick={() => {
              if (duplicates.length > 0 && ackDuplicates && !hasStrong) {
                createMut.mutate();
                return;
              }
              checkMut.mutate();
            }}
          >
            {checkMut.isPending || createMut.isPending ? 'در حال ذخیره…' : 'ایجاد شخص'}
          </Button>
          <Link href={ROUTES.parties} className={cn(buttonVariants({ variant: 'outline' }))}>
            انصراف
          </Link>
        </div>
      </div>
    </div>
  );
}
