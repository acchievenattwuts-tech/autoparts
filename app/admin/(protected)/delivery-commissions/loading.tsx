export default function LoadingDeliveryCommissionsPage() {
  return (
    <div className="space-y-4">
      <div className="h-8 w-64 animate-pulse rounded bg-gray-200 dark:bg-slate-800" />
      <div className="h-28 animate-pulse rounded-xl bg-gray-100 dark:bg-slate-900" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-slate-900" />
        <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-slate-900" />
        <div className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-slate-900" />
      </div>
      <div className="h-96 animate-pulse rounded-xl bg-gray-100 dark:bg-slate-900" />
    </div>
  );
}
