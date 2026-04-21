type LazadaLogoIconProps = {
  className?: string;
};

const LazadaLogoIcon = ({ className = "h-5 w-5" }: LazadaLogoIconProps) => (
  <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
    <defs>
      <linearGradient id="lazada-primary-gradient" x1="11.43" y1="8.53" x2="52.57" y2="55.47" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#FFB000" />
        <stop offset="0.42" stopColor="#FF4F8B" />
        <stop offset="1" stopColor="#5B2EFF" />
      </linearGradient>
    </defs>
    <path
      fill="url(#lazada-primary-gradient)"
      d="M32 12.47c3.22-3.42 7.97-5.47 13.06-5.47C54.6 7 62 14.4 62 23.94c0 5.32-2.24 9.65-6.72 14.02L32 59 8.72 37.96C4.24 33.59 2 29.26 2 23.94 2 14.4 9.4 7 18.94 7c5.09 0 9.84 2.05 13.06 5.47Z"
    />
    <path
      fill="#fff"
      d="M32 21.53 20.19 28.4v9.8L32 45.07l11.81-6.87v-9.8L32 21.53Zm0 7.03 4.84 2.82L32 34.2l-4.84-2.82L32 28.56Z"
    />
  </svg>
);

export default LazadaLogoIcon;
