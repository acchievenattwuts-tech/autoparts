import {
  CircleDot,
  Cog,
  Droplets,
  Fan,
  Flame,
  Snowflake,
  SlidersHorizontal,
  Thermometer,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import {
  DEFAULT_CATEGORY_VISUAL,
  type CategoryIconKey,
  type CategoryMotionKey,
  type CategoryToneKey,
  type CategoryVisualSetting,
} from "@/lib/category-visual-config";

const ICONS: Record<CategoryIconKey, LucideIcon> = {
  compressor: Cog,
  evaporator: Snowflake,
  condenser: Flame,
  radiator: Thermometer,
  blower: Fan,
  valve: SlidersHorizontal,
  dryer: CircleDot,
  wrench: Wrench,
  droplets: Droplets,
  gear: Cog,
};

const TONE_CLASSES: Record<CategoryToneKey, { shell: string; icon: string; glow: string }> = {
  neutral: {
    shell: "border-gray-200 bg-gray-100",
    icon: "text-gray-800",
    glow: "shadow-gray-200/60",
  },
  ice: {
    shell: "border-cyan-200 bg-cyan-50",
    icon: "text-cyan-700",
    glow: "shadow-cyan-200/70",
  },
  heat: {
    shell: "border-orange-200 bg-orange-50",
    icon: "text-orange-700",
    glow: "shadow-orange-200/70",
  },
  water: {
    shell: "border-rose-200 bg-rose-50",
    icon: "text-rose-700",
    glow: "shadow-rose-200/70",
  },
  electric: {
    shell: "border-yellow-200 bg-yellow-50",
    icon: "text-yellow-700",
    glow: "shadow-yellow-200/70",
  },
  air: {
    shell: "border-emerald-200 bg-emerald-50",
    icon: "text-emerald-700",
    glow: "shadow-emerald-200/70",
  },
};

const MOTION_CLASSES: Record<CategoryMotionKey, string> = {
  lift: "group-hover:-translate-y-0.5 group-hover:scale-105",
  spin: "group-hover:rotate-[22deg] group-hover:scale-105",
  breeze: "group-hover:translate-x-1 group-hover:-translate-y-0.5",
  pulse: "group-hover:scale-110",
  heat: "group-hover:-translate-y-1 group-hover:rotate-3",
  swing: "group-hover:-rotate-12 group-hover:scale-105",
};

export const getCategoryToneClasses = (toneKey: CategoryToneKey) =>
  TONE_CLASSES[toneKey] ?? TONE_CLASSES[DEFAULT_CATEGORY_VISUAL.toneKey];

export const CategoryVisualIcon = ({
  visual,
  className = "",
  iconClassName = "",
}: {
  visual?: CategoryVisualSetting;
  className?: string;
  iconClassName?: string;
}) => {
  const resolvedVisual = visual ?? DEFAULT_CATEGORY_VISUAL;
  const Icon = ICONS[resolvedVisual.iconKey] ?? ICONS[DEFAULT_CATEGORY_VISUAL.iconKey];
  const tone = getCategoryToneClasses(resolvedVisual.toneKey);
  const motion = MOTION_CLASSES[resolvedVisual.motionKey] ?? MOTION_CLASSES.lift;

  return (
    <span
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border shadow-sm transition-all duration-300 group-hover:shadow-md ${tone.shell} ${tone.glow} ${className}`}
    >
      <Icon
        aria-hidden="true"
        strokeWidth={2.3}
        className={`h-6 w-6 transition-transform duration-300 ease-out ${tone.icon} ${motion} ${iconClassName}`}
      />
    </span>
  );
};
