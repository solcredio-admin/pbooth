"use client";
import { useState } from "react";
import { EventForm } from "./EventForm";
import { EventVouchers } from "./EventVouchers";
import { Tabs } from "./Tabs";
import type { EventDto } from "@/lib/types";

type Pane = "settings" | "vouchers";

// The event page's centre column: the settings form, plus Vouchers for self-service events.
export function EventMain({ event, canEdit, lockMoney }: { event: EventDto; canEdit: boolean; lockMoney: boolean }) {
  const [pane, setPane] = useState<Pane>("settings");
  const form = <section className="host" aria-label="Event settings"><div className="panel"><EventForm key={event.updatedAt} event={event} canEdit={canEdit} lockMoney={lockMoney} /></div></section>;
  if (event.kind !== "SELF_SERVICE" || !canEdit) return form;
  return (
    <>
      <Tabs label="Event" tabs={[{ id: "settings", label: "Settings" }, { id: "vouchers", label: "Vouchers" }]} value={pane} onChange={setPane} />
      <div className="tab-pane" hidden={pane !== "settings"}>{form}</div>
      <div className="tab-pane" hidden={pane !== "vouchers"}><EventVouchers event={event} /></div>
    </>
  );
}
