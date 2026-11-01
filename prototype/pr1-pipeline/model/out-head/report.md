# CardSpend

TLC reached 19 states and 30 steps. The chart draws 8 states and 11 arrows.
The chart does not draw 7 steps that stay in one chart state.

## SpendShows breaks
The shortest path has 5 steps:
0. not drawn yet
1. you break down the page: drawing
2. the call fails after spending: failed
3. you press Retry: redrawing
4. you dismiss it: dismissed, call still out
5. the call comes back to no card: dismissed

## Rules that hold
BudgetFirst, NoDeadlock
