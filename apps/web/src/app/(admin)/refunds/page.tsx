import type { Metadata } from "next";
import { apiGet } from "@/lib/server-api";
import { Refunds, type RefundRow } from "@/components/Refunds";
import { SalesTabs } from "@/components/SalesTabs";

export const metadata: Metadata = { title: "Refunds" };

export default async function RefundsPage() {
  const [open, done] = await Promise.all([apiGet<{ items: RefundRow[]; openCount: number }>("/refunds"), apiGet<{ items: RefundRow[] }>("/refunds?status=done")]);
  return (
    <>
      <section className="hero compact"><span className="cap">{open.openCount} waiting</span><h1>Refunds.</h1></section>
      <main><SalesTabs open={open.openCount} /><Refunds open={open.items} done={done.items} /></main>
    </>
  );
}
