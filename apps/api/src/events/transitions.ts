import { EventStatus } from "../generated/prisma/enums.js";

// The only legal status moves. Anything else is rejected with 409.
//   DRAFT ─schedule→ SCHEDULED ─activate→ ACTIVE ─complete→ COMPLETED ─archive→ ARCHIVED
// activate also works from DRAFT (quick setup) and from COMPLETED (undo an early "complete"
// during a live event). archive also retires drafts/scheduled events that won't happen.
export const TRANSITIONS = {
  schedule: { from: [EventStatus.DRAFT], to: EventStatus.SCHEDULED },
  activate: { from: [EventStatus.DRAFT, EventStatus.SCHEDULED, EventStatus.COMPLETED], to: EventStatus.ACTIVE },
  complete: { from: [EventStatus.ACTIVE], to: EventStatus.COMPLETED },
  archive: { from: [EventStatus.DRAFT, EventStatus.SCHEDULED, EventStatus.COMPLETED], to: EventStatus.ARCHIVED },
} as const;

export type Transition = keyof typeof TRANSITIONS;

export const canTransition = (from: EventStatus, t: Transition) =>
  (TRANSITIONS[t].from as readonly EventStatus[]).includes(from);

/** Actions offered to the UI for an event in this status. */
export const allowedTransitions = (from: EventStatus) =>
  (Object.keys(TRANSITIONS) as Transition[]).filter((t) => canTransition(from, t));
