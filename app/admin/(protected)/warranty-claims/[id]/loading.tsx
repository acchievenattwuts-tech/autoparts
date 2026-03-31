const Loading = () => (
  <div className="animate-pulse space-y-4">
    <div className="h-8 bg-gray-100 rounded-lg w-48" />
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-4">
        <div className="h-48 bg-gray-100 rounded-xl" />
        <div className="h-48 bg-gray-100 rounded-xl" />
      </div>
      <div className="h-64 bg-gray-100 rounded-xl" />
    </div>
  </div>
);

export default Loading;
