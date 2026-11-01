---- MODULE Flow ----
\* docviz MVP: one PR from the authoring agent's loop to merge. See ../mvp-verification.md.
\* Check results are nondeterministic: TLC tries every outcome.
EXTENDS Naturals
VARIABLES phase, rounds, breaks, contra, unknown, changed, verdict, rulesTouched, verifier, stale, spent, shown
vars == <<phase, rounds, breaks, contra, unknown, changed, verdict, rulesTouched, verifier, stale, spent, shown>>

Init == phase = "writing" /\ rounds = 0 /\ breaks = FALSE /\ contra = FALSE /\ unknown = FALSE
  /\ changed = FALSE /\ verdict = "none" /\ rulesTouched = FALSE /\ verifier = "none"
  /\ stale = FALSE /\ spent = 0 /\ shown = 0

\* Fail-safe: anything unknown falls toward "needs you".
Verdict(b, c, u, ch, rt) == IF b \/ c \/ rt THEN "needs" ELSE IF ch \/ u THEN "look" ELSE "nothing"
\* Every check is a Jev call, charged to the comment as it returns.
Pay == spent' = spent + 1 /\ shown' = shown + 1

\* The agent runs docviz on its branch: TLC on the rules, Jev on the steps.     [code, formal, Jev]
AgentChecks == phase = "writing" /\ \E b, c, u, ch \in BOOLEAN :
  breaks' = b /\ contra' = c /\ unknown' = u /\ changed' = ch
  /\ verdict' = Verdict(b, c, u, ch, rulesTouched) /\ phase' = "checked" /\ Pay
  /\ UNCHANGED <<rounds, rulesTouched, verifier, stale>>
\* A mistake an agent can make; docviz flags any agent diff that touches .atlas/rules.md.
AgentEditsRules == phase = "writing" /\ ~rulesTouched /\ rulesTouched' = TRUE
  /\ UNCHANGED <<phase, rounds, breaks, contra, unknown, changed, verdict, verifier, stale, spent, shown>>
\* Fix the code and rerun, at most 2 rounds.                                     [agent]
AgentFixes == phase = "checked" /\ verdict = "needs" /\ rounds < 2 /\ phase' = "writing"
  /\ rounds' = rounds + 1 /\ UNCHANGED <<breaks, contra, unknown, changed, verdict, rulesTouched, verifier, stale, spent, shown>>
AgentOpensPR == phase = "checked" /\ (verdict # "needs" \/ rounds = 2) /\ phase' = "open"
  /\ UNCHANGED <<rounds, breaks, contra, unknown, changed, verdict, rulesTouched, verifier, stale, spent, shown>>
\* A verifier that didn't write the PR reruns docviz on the same code. TLC is exact;
\* Jev's answers may move.                                                      [agent, not the author]
VerifierRuns == phase = "open" /\ \E c, u \in BOOLEAN :
  LET v == Verdict(breaks, c, u, changed, rulesTouched) IN
    /\ verifier' = IF v = verdict /\ v # "needs" THEN "pass" ELSE "fail"
    /\ phase' = IF v = verdict /\ v # "needs" THEN "verified" ELSE "held"
    /\ stale' = FALSE /\ Pay
    /\ UNCHANGED <<rounds, breaks, contra, unknown, changed, verdict, rulesTouched>>
\* A new commit after the verdict: the verdict no longer covers the head (Shipping, step 3).
AgentPushesAgain == phase = "verified" /\ phase' = "open" /\ stale' = TRUE /\ verifier' = "none"
  /\ UNCHANGED <<rounds, breaks, contra, unknown, changed, verdict, rulesTouched, spent, shown>>
Merge == phase = "verified" /\ verifier = "pass" /\ ~stale /\ phase' = "merged"
  /\ UNCHANGED <<rounds, breaks, contra, unknown, changed, verdict, rulesTouched, verifier, stale, spent, shown>>
Done == phase \in {"merged", "held"} /\ UNCHANGED vars

Next == AgentChecks \/ AgentEditsRules \/ AgentFixes \/ AgentOpensPR \/ VerifierRuns
  \/ AgentPushesAgain \/ Merge \/ Done

\* The user's rules, word for word.
\* 1. "Nothing for you" only when no rule breaks and every step is confirmed. Anything unknown
\*    counts as "look when you can" or worse.
NothingOnlyWhenConfirmed == verdict = "nothing" => ~breaks /\ ~contra /\ ~unknown /\ ~rulesTouched
\* 2. An agent never edits .atlas/rules.md.  (Modelled as: a PR that does is never merged.)
RulesEditsNeverLand == rulesTouched => phase # "merged"
\* 3. A PR merges only with a PASS from an agent that didn't write it.
MergeOnlyOnPass == phase = "merged" => verifier = "pass"
\* 4. The fix loop before opening the PR runs at most 2 rounds, then the PR opens flagged.
AtMostTwoRounds == rounds <= 2
\* 5. A PR that still breaks a rule is never opened as anything less than "needs you."
BreaksOpenAsNeedsYou == phase \in {"open", "verified", "held", "merged"} /\ breaks => verdict = "needs"
\* 6. Every model call docviz makes shows up in the comment's cost.
EveryCallShown == spent = shown

Small == spent <= 6
====
