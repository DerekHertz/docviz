---- MODULE CardSpend ----
\* PROTOTYPE. One docviz card and the money its calls spend, before and after PR #1.
\* Head = FALSE is the base (921e385), Head = TRUE is PR #1 (3d37957).
EXTENDS Naturals
CONSTANTS Head, Budget, MaxPaid
VARIABLES card, calling, paid, shown, lost, startedOver
vars == <<card, calling, paid, shown, lost, startedOver>>

Init == card = "none" /\ calling = FALSE /\ paid = 0 /\ shown = 0 /\ lost = 0 /\ startedOver = FALSE

Over == paid >= Budget
\* PR #1: callHelper refuses before spending once today's budget is used up.
CanCall == ~Head \/ ~Over
StartCall == calling' = TRUE /\ startedOver' = (startedOver \/ Over)
\* PR #1 charges every reported usage to the card or the page total; the base charged nothing.
Charge == IF Head THEN shown' = shown + 1 ELSE UNCHANGED shown
After(c) == IF c = "drawing" THEN "failed" ELSE "shown"

YouBreakDown == card = "none" /\ card' = "drawing" /\ StartCall /\ UNCHANGED <<paid, shown, lost>>
CardArrives == calling /\ card \in {"drawing", "redrawing"} /\ card' = "shown" /\ calling' = FALSE
  /\ paid' = paid + 1 /\ Charge /\ UNCHANGED <<lost, startedOver>>
CallFails == calling /\ card \in {"drawing", "redrawing"} /\ card' = After(card) /\ calling' = FALSE
  /\ paid' = paid + 1 /\ Charge /\ UNCHANGED <<lost, startedOver>>
\* SPEC: a timeout kills the CLI before it reports, so that spend can't be shown (accepted).
TimesOut == calling /\ card \in {"drawing", "redrawing"} /\ card' = After(card) /\ calling' = FALSE
  /\ paid' = paid + 1 /\ lost' = lost + 1 /\ UNCHANGED <<shown, startedOver>>
YouPressSimpler == card = "shown" /\ ~calling /\ CanCall /\ card' = "redrawing" /\ StartCall /\ UNCHANGED <<paid, shown, lost>>
YouRetry == card = "failed" /\ ~calling /\ CanCall /\ card' = "redrawing" /\ StartCall /\ UNCHANGED <<paid, shown, lost>>
YouDismiss == card \in {"shown", "failed", "redrawing"} /\ card' = "dismissed" /\ UNCHANGED <<calling, paid, shown, lost, startedOver>>
\* generate(): getCard is undefined after dismiss, so cur.cost throws and the catch returns uncharged.
LateReturn == calling /\ card = "dismissed" /\ calling' = FALSE /\ paid' = paid + 1 /\ UNCHANGED <<card, shown, lost, startedOver>>
Done == card = "dismissed" /\ ~calling /\ UNCHANGED vars

Next == YouBreakDown \/ CardArrives \/ CallFails \/ TimesOut \/ YouPressSimpler \/ YouRetry
  \/ YouDismiss \/ LateReturn \/ Done

\* The user's rules, from CLAUDE.md and SPEC.md.
\* "Never add a call that spends without showing up in the card's cost breakdown."
SpendShows == ~calling => paid = shown + lost
\* "The budget check runs before every call."
BudgetFirst == ~startedOver

Small == paid <= MaxPaid
====
