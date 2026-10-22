import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "@/lib/utils";

const button = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-fg text-bg hover:bg-fg/90",
        secondary: "bg-raised text-fg hover:bg-raised/70 border border-line",
        ghost: "text-muted hover:bg-raised hover:text-fg",
        danger: "bg-loss/15 text-loss hover:bg-loss/25 border border-loss/30",
        review: "bg-review text-black hover:bg-review/90",
      },
      size: { sm: "h-8 px-3", md: "h-10 px-4", lg: "h-12 px-6 text-base", icon: "h-9 w-9" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof button> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => (
  <button ref={ref} className={cn(button({ variant, size }), className)} {...props} />
));
Button.displayName = "Button";
