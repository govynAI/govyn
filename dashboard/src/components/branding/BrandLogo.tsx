import wordmarkBlack from "@/assets/branding/govyn-wordmark-black.png";
import wordmarkWhite from "@/assets/branding/govyn-wordmark-white.png";
import monogramBlack from "@/assets/branding/govyn-monogram-black.png";
import monogramWhite from "@/assets/branding/govyn-monogram-white.png";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

interface BrandLogoProps {
  compact?: boolean;
  className?: string;
}

export default function BrandLogo({
  compact = false,
  className,
}: BrandLogoProps) {
  const { isDark } = useTheme();
  const src = compact
    ? (isDark ? monogramWhite : monogramBlack)
    : (isDark ? wordmarkWhite : wordmarkBlack);

  return (
    <img
      src={src}
      alt="Govyn"
      draggable={false}
      className={cn(
        "select-none object-contain",
        compact ? "h-10 w-auto" : "h-9 w-auto",
        className,
      )}
    />
  );
}
