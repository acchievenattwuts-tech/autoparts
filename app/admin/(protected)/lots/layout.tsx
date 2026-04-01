import { Layers } from "lucide-react";
import LotTabNav from "./LotTabNav";

export default function LotsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Layers size={22} className="text-blue-600" />
        <h1 className="text-xl font-bold">Stock Card Lot</h1>
      </div>
      <LotTabNav />
      {children}
    </div>
  );
}
