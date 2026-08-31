import Image from "next/image";

type ShopeeLogoIconProps = {
  className?: string;
};

const ShopeeLogoIcon = ({ className = "h-5 w-5" }: ShopeeLogoIconProps) => (
  <Image
    src="/logo-shopee.png"
    alt="Shopee"
    width={234}
    height={262}
    sizes="24px"
    className={`${className} object-contain`}
  />
);

export default ShopeeLogoIcon;
