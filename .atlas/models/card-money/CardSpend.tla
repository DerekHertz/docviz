---- MODULE CardSpend ----
\* One docviz card and the money its calls spend (extension/background.js).
\* Moved from prototype/pr1-pipeline/model/ at its head (PR #1, Head = TRUE inlined).
\* The dismiss gap (LateReturn) is in the code until PR #10 lands, so SpendShows breaks here.
EXTENDS Naturals
CONSTANTS Budget, MaxPaid
VARIABLES card, calling, paid, shown, lost, startedOver
vars == <<card, calling, paid, shown, lost, startedOver>>

Init == card = "none" /\ calling = FALSE /\ paid = 0 /\ shown = 0 /\ lost = 0 /\ startedOver = FALSE

Over == paid >= Budget
\* callHelper: budgetRefusal(s) refuses before fetch once today's budget is used up.
CanCall == ~Over
StartCall == calling' = TRUE /\ startedOver' = (startedOver \/ Over)
\* callHelper records every reported usage; generate adds it to the card's cost.
Charge == shown' = shown + 1
After(c) == IF c = "drawing" THEN "failed" ELSE "shown"

\* breakdown -> generate -> callHelper
YouBreakDown == card = "none" /\ card' = "drawing" /\ StartCall /\ UNCHANGED <<paid, shown, lost>>
\* callHelper (record) -> generate (putCard with addCost)
CardArrives == calling /\ card \in {"drawing", "redrawing"} /\ card' = "shown" /\ calling' = FALSE
  /\ paid' = paid + 1 /\ Charge /\ UNCHANGED <<lost, startedOver>>
\* callHelper throws with usage -> generate's catch (addCost 'failed attempt')
CallFails == calling /\ card \in {"drawing", "redrawing"} /\ card' = After(card) /\ calling' = FALSE
  /\ paid' = paid + 1 /\ Charge /\ UNCHANGED <<lost, startedOver>>
\* SPEC: a timeout kills the CLI before it reports, so that spend can't be shown (accepted).
\* callHelper: no usage to record -> generate's catch adds nothing
TimesOut == calling /\ card \in {"drawing", "redrawing"} /\ card' = After(card) /\ calling' = FALSE
  /\ paid' = paid + 1 /\ lost' = lost + 1 /\ UNCHANGED <<shown, startedOver>>
\* 'card:adjust' -> adjust (budgetRefusal first) -> learn -> generate
YouPressSimpler == card = "shown" /\ ~calling /\ CanCall /\ card' = "redrawing" /\ StartCall /\ UNCHANGED <<paid, shown, lost>>
\* 'card:retry' -> generate -> callHelper (refused there when over budget)
YouRetry == card = "failed" /\ ~calling /\ CanCall /\ card' = "redrawing" /\ StartCall /\ UNCHANGED <<paid, shown, lost>>
\* 'card:dismiss' -> dismiss: removes the card record, even with a call out
YouDismiss == card \in {"shown", "failed", "redrawing"} /\ card' = "dismissed" /\ UNCHANGED <<calling, paid, shown, lost, startedOver>>
\* generate(): getCard is undefined after dismiss, so cur.cost throws and the catch returns uncharged.
LateReturn == calling /\ card = "dismissed" /\ calling' = FALSE /\ paid' = paid + 1 /\ UNCHANGED <<card, shown, lost, startedOver>>
Done == card = "dismissed" /\ ~calling /\ UNCHANGED vars

Next == YouBreakDown \/ CardArrives \/ CallFails \/ TimesOut \/ YouPressSimpler \/ YouRetry
  \/ YouDismiss \/ LateReturn \/ Done

\* The user's rules (.atlas/rules.md), from CLAUDE.md and SPEC.md.
SpendShows == ~calling => paid = shown + lost
BudgetFirst == ~startedOver

Small == paid <= MaxPaid
====
