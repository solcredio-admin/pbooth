"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function SalesTabs({ open }: { open: number }) {
  const path = usePathname();
  return (
    <nav className="tabs sales-tabs" aria-label="Sales">
      <Link href="/transactions" aria-current={path === "/transactions" ? "page" : undefined}>Transactions</Link>
      <Link href="/refunds" aria-current={path === "/refunds" ? "page" : undefined}>Refunds{open ? ` · ${open}` : ""}</Link>
    </nav>
  );
}
