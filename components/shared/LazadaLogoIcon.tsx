import Image from "next/image";

type LazadaLogoIconProps = {
  className?: string;
};

const LazadaLogoIcon = ({ className = "h-5 w-5" }: LazadaLogoIconProps) => (
  <Image
    src="/logo-lazada.webp"
    alt="Lazada"
    width={592}
    height={481}
    sizes="24px"
    className={`${className} object-contain`}
  />
);

export default LazadaLogoIcon;
