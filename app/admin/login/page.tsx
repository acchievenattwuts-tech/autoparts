import { getSiteConfig } from "@/lib/site-config";
import LoginForm from "./LoginForm";

const LoginPage = async () => {
  const config = await getSiteConfig();

  return <LoginForm shopName={config.shopName} shopLogoUrl={config.shopLogoUrl} />;
};

export default LoginPage;
