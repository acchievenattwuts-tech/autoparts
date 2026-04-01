import { redirect } from "next/navigation";

export default function LotsRootPage() {
  redirect("/admin/lots/balance");
}
