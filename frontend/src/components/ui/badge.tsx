import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: "default" | "warning" | "muted" | "success" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-xl px-2.5 py-1 text-[10px] font-semibold",
        variant === "default" && "bg-primary text-primary-foreground",
        variant === "warning" && "bg-amber-100 text-amber-800",
        variant === "muted" && "bg-muted text-muted-foreground",
        variant === "success" && "bg-emerald-100 text-emerald-800",
        className
      )}
      {...props}
    />
  );
}
