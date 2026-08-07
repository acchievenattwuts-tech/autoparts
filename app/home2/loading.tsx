const SKELETON_TILES = Array.from({ length: 8 }, (_, index) => index);
const SKELETON_CARDS = Array.from({ length: 6 }, (_, index) => index);

const Home2Loading = () => (
  <div className="min-h-full bg-[#f4f7fc]">
    <div className="h-[7.5rem] bg-gradient-to-b from-[#1e3a5f] to-[#254b7a]" />

    <div className="mx-auto max-w-7xl animate-pulse px-4 pt-4 sm:px-6 lg:px-8">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="h-56 rounded-2xl bg-[#dbe6f5]" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          <div className="h-[6.5rem] rounded-2xl bg-white" />
          <div className="h-[6.5rem] rounded-2xl bg-white" />
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-2xl border border-[#dbe6f5] bg-[#eef3fa] sm:grid-cols-4 lg:grid-cols-8">
        {SKELETON_TILES.map((tile) => (
          <div key={tile} className="flex flex-col items-center gap-2 bg-white px-2 py-4">
            <span className="h-12 w-12 rounded-full bg-[#eff5fc]" />
            <span className="h-2.5 w-14 rounded bg-[#eff5fc]" />
          </div>
        ))}
      </div>

      <div className="mt-3 rounded-2xl border border-[#dbe6f5] bg-white p-4">
        <div className="mb-4 h-4 w-40 rounded bg-[#eff5fc]" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {SKELETON_CARDS.map((card) => (
            <div key={card} className="rounded-xl border border-[#e3ecf8]">
              <div className="aspect-square rounded-t-xl bg-[#f4f7fc]" />
              <div className="space-y-2 p-2.5">
                <div className="h-2.5 w-full rounded bg-[#eff5fc]" />
                <div className="h-2.5 w-2/3 rounded bg-[#eff5fc]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </div>
);

export default Home2Loading;
