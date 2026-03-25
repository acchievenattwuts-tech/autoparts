// Force all /admin/* routes to render at request time (not at build time).
// This prevents Next.js from pre-rendering admin pages during `npm run build`,
// which would open DB connections for every page simultaneously and exhaust
// the Supabase Session-mode connection pool.
export const dynamic = "force-dynamic";

export default function AdminRootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
