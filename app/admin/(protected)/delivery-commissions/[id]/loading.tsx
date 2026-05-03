import { LoaderCircle } from "lucide-react";

export default function Loading() {
  return (
    <div className="flex items-center justify-center py-20 text-gray-400 dark:text-slate-500">
      <LoaderCircle size={20} className="mr-2 animate-spin" />
      กำลังโหลด...
    </div>
  );
}
