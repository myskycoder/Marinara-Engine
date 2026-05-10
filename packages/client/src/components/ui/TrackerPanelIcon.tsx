import type { SVGProps } from "react";

type TrackerPanelIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string;
};

export function TrackerPanelIcon({ size = "1em", strokeWidth = 1.9, className, ...props }: TrackerPanelIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M12 2.75 20.25 7v10L12 21.25 3.75 17V7L12 2.75Z" fill="currentColor" fillOpacity="0.08" stroke="none" />
      <path d="M12 2.75 20.25 7v10L12 21.25 3.75 17V7L12 2.75Z" />
      <path d="M3.75 7h16.5" />
      <path d="M3.75 17h16.5" opacity="0.62" />
      <path d="M12 2.75v18.5" opacity="0.75" />
      <path d="m3.75 7 4.65 5-4.65 5" opacity="0.7" />
      <path d="m20.25 7-4.65 5 4.65 5" opacity="0.7" />
      <path d="M8.4 12h7.2" opacity="0.78" />
      <path d="m8.4 12 3.6-9.25 3.6 9.25L12 21.25 8.4 12Z" opacity="0.52" />
    </svg>
  );
}
