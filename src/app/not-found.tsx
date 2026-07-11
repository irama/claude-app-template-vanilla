import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-gray-600">The page you’re looking for doesn’t exist.</p>
      <Link href="/" className="mt-4 text-sm underline">
        Back to home
      </Link>
    </main>
  );
}
