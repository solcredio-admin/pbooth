"use client";
import { useState } from "react";
import { EventForm } from "./EventForm";
import { EventFrames } from "./EventFrames";
import { EventVouchers } from "./EventVouchers";
import { Tabs } from "./Tabs";
import type { EventDto } from "@/lib/types";

type Pane = "settings" | "frames" | "vouchers";

// The event page's centre column: the settings form, the owner's frames, and Vouchers for self-service events.
export function EventMain({ event, canEdit, lockMoney, vouchers, makeVouchers }: { event: EventDto; canEdit: boolean; lockMoney: boolean; vouchers: boolean; makeVouchers: boolean }) {
  const [pane, setPane] = useState<Pane>("settings");
  const form = <section className="host" aria-label="Event settings"><div className="panel"><EventForm key={event.updatedAt} event={event} canEdit={canEdit} lockMoney={lockMoney} /></div></section>;
  const tabs: { id: Pane; label: string }[] = [{ id: "settings", label: "Settings" }, ...(canEdit ? [{ id: "frames" as const, label: "Frames" }] : []), ...(vouchers ? [{ id: "vouchers" as const, label: "Vouchers" }] : [])];
  return (
    <>
      <Tabs label="Event" tabs={tabs} value={pane} onChange={setPane} />
      <div className="tab-pane" hidden={pane !== "settings"}>{form}</div>
      {canEdit && <div className="tab-pane" hidden={pane !== "frames"}><EventFrames event={event} readOnly={false} /></div>}
      {vouchers && <div className="tab-pane" hidden={pane !== "vouchers"}><EventVouchers event={event} readOnly={!makeVouchers} /></div>}
    </>
  );
}
