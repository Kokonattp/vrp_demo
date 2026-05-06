import * as React from "react";
import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "secondary" | "ghost" | "outline" | "destructive";
type ButtonSize = "sm" | "md" | "icon";

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variants: Record<ButtonVariant, string> = {
  default: "border-2 border-foreground bg-primary text-primary-foreground shadow-[3px_3px_0_hsl(var(--foreground))] hover:-translate-y-0.5 hover:shadow-[4px_4px_0_hsl(var(--foreground))]",
  secondary: "border-2 border-foreground bg-secondary text-secondary-foreground shadow-[2px_2px_0_hsl(var(--foreground))] hover:bg-secondary/80",
  ghost: "hover:bg-secondary text-foreground",
  outline: "border-2 border-foreground bg-card text-foreground shadow-[2px_2px_0_hsl(var(--foreground))] hover:bg-primary",
  destructive: "border-2 border-foreground bg-destructive text-destructive-foreground shadow-[3px_3px_0_hsl(var(--foreground))] hover:bg-destructive/90"
};

const sizes: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  icon: "h-9 w-9 p-0"
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-all disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  )
);

Button.displayName = "Button";
