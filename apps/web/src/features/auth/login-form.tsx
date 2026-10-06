'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { isApiClientError } from '@/lib/api/errors';
import { ROUTES } from '@/lib/utils/routes';
import { useSession } from '@/providers/app-providers';

const schema = z.object({
  email: z.string().email('ایمیل معتبر وارد کنید'),
  password: z.string().min(1, 'رمز عبور الزامی است'),
});

type FormValues = z.infer<typeof schema>;

export function LoginForm() {
  const { login, status } = useSession();
  const router = useRouter();
  const [formError, setFormError] = React.useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  React.useEffect(() => {
    if (status === 'authenticated') {
      router.replace(ROUTES.dashboard);
    }
  }, [status, router]);

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values.email, values.password);
    } catch (error) {
      if (isApiClientError(error)) {
        if (error.code === 'INVALID_CREDENTIALS' || error.status === 401) {
          setFormError('ایمیل یا رمز عبور نادرست است.');
        } else {
          setFormError(error.message);
        }
      } else {
        setFormError('ارتباط با سرور برقرار نشد. دوباره تلاش کنید.');
      }
    }
  });

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-slate-900 text-sm font-bold text-white">
            H
          </span>
          <div>
            <h1 className="text-lg font-semibold">ورود به هکتور</h1>
            <p className="text-sm text-slate-500">سیستم مدیریت کسب‌وکار پیشته</p>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <div>
            <Label htmlFor="email">ایمیل</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              dir="ltr"
              className="text-start"
              {...register('email')}
            />
            {errors.email ? (
              <p className="mt-1 text-xs text-red-600">{errors.email.message}</p>
            ) : null}
          </div>
          <div>
            <Label htmlFor="password">رمز عبور</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              dir="ltr"
              className="text-start"
              {...register('password')}
            />
            {errors.password ? (
              <p className="mt-1 text-xs text-red-600">{errors.password.message}</p>
            ) : null}
          </div>
          {formError ? (
            <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
              {formError}
            </div>
          ) : null}
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? 'در حال ورود...' : 'ورود'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
