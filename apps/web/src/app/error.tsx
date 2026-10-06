'use client';

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 px-4 text-center">
      <h1 className="text-xl font-semibold">مشکلی پیش آمد</h1>
      <p className="text-sm text-slate-500">دوباره تلاش کنید.</p>
      <button
        type="button"
        className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
        onClick={() => reset()}
      >
        تلاش مجدد
      </button>
    </main>
  );
}
