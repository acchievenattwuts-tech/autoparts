const Loading = () => (
  <div className="animate-pulse space-y-4">
    <div className="h-8 bg-gray-100 rounded-lg w-48" />
    <div className="grid grid-cols-3 gap-4">
      {[1, 2, 3].map((i) => <div key={i} className="h-20 bg-gray-100 rounded-xl" />)}
    </div>
    <div className="h-12 bg-gray-100 rounded-xl" />
    <div className="h-64 bg-gray-100 rounded-xl" />
  </div>
);

export default Loading;
