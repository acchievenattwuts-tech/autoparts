type StampTone = "paid" | "cancelled";

const STAMP_TONE_CLASS: Record<StampTone, string> = {
  paid: "border-emerald-600 text-emerald-700",
  cancelled: "border-rose-600 text-rose-700",
};

export default function PrintDocumentStatusStamp({
  label,
  tone,
}: {
  label: string;
  tone: StampTone;
}) {
  return (
    <div
      aria-label={label}
      className={`pointer-events-none absolute right-8 top-24 z-10 rotate-[-12deg] rounded-md border-4 bg-white/70 px-5 py-2 font-kanit text-2xl font-black tracking-wider opacity-90 ${STAMP_TONE_CLASS[tone]}`}
    >
      {label}
    </div>
  );
}
