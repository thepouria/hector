import type { Metadata } from 'next';
import { LoginForm } from '@/features/auth/login-form';

export const metadata: Metadata = {
  title: 'ورود',
};

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-b from-slate-100 to-slate-50 px-4 py-10">
      <LoginForm />
    </main>
  );
}
