// The reader's words for each card state and step. Matches Budget in CardSpend.cfg.
const BUDGET = 2;
export const title = "One card and its money";
export const state = (v) => {
  if (v.card === "none") return "not drawn yet";
  if (v.card === "drawing") return "drawing";
  if (v.card === "redrawing") return "redrawing";
  if (v.card === "failed") return "failed";
  if (v.card === "dismissed") return v.calling ? "dismissed, call still out" : "dismissed";
  return v.paid >= BUDGET ? "on the page, budget used up" : "on the page";
};
const labels = {
  YouBreakDown: "you break down the page",
  CardArrives: "the card comes back",
  CallFails: "the call fails after spending",
  TimesOut: "the call times out",
  YouPressSimpler: "you press Simpler",
  YouRetry: "you press Retry",
  YouDismiss: "you dismiss it",
  LateReturn: "the call comes back to no card",
  Done: null,
};
export const step = (action) => labels[action] ?? action;
