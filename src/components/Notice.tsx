import type { ReactNode } from "react";
import { cn } from "../lib/cn";

export function Notice({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex gap-3 rounded-3xl border p-4 text-sm leading-6", className)}>
      {children}
    </div>
  );
}
