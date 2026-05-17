export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";

const AdminIndexPage = () => {
  redirect("/admin/workboard");
};

export default AdminIndexPage;
