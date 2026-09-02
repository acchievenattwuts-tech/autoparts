const Loading = () => (
  <div className="animate-pulse">
    <div className="flex items-center justify-between gap-3 border-b bg-white p-4">
      <div className="h-5 w-48 rounded bg-gray-200" />
      <div className="flex items-center gap-3">
        <div className="h-8 w-24 rounded-lg bg-gray-200" />
        <div className="h-8 w-28 rounded-lg bg-gray-200" />
      </div>
    </div>
    <div className="mx-auto my-6 h-[148mm] w-[210mm] max-w-full rounded bg-white shadow-sm">
      <div className="space-y-4 p-8">
        <div className="h-28 rounded-2xl border border-gray-100 bg-gray-50" />
        <div className="h-56 rounded-2xl border border-gray-100 bg-gray-50" />
      </div>
    </div>
  </div>
);

export default Loading;
