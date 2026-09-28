import { ADMIN_SESSION_END_REASON_PARAM, getAdminSessionEndMessage } from "@/lib/admin-session-watch";
import { getSiteConfig } from "@/lib/site-config";
import LoginForm from "./LoginForm";

type LoginPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const LoginPage = async ({ searchParams }: LoginPageProps) => {
  const [config, params] = await Promise.all([getSiteConfig(), searchParams]);
  const sessionEndMessage = getAdminSessionEndMessage(params[ADMIN_SESSION_END_REASON_PARAM]);

  return (
    <LoginForm
      shopName={config.shopName}
      shopLogoUrl={config.shopLogoUrl}
      sessionEndMessage={sessionEndMessage}
    />
  );
};

export default LoginPage;
