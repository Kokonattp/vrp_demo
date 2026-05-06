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
        "inline-flex items-center rounded-md border border-foreground px-2 py-0.5 text-xs font-semibold",
        variant === "default" && "bg-primary text-primary-foreground",
        variant === "warning" && "bg-primary text-primary-foreground",
        variant === "muted" && "bg-muted text-muted-foreground",
        variant === "success" && "bg-emerald-100 text-emerald-950",
        className
      )}
      {...props}
    />
  );
}
