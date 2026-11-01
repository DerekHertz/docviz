# CardSpend

TLC reached 59 states and 98 steps. The chart draws 8 states and 12 arrows.
The chart does not draw 14 steps that stay in one chart state.

## SpendShows breaks
The shortest path has 2 steps:
0. not drawn yet
1. you break down the page: drawing
2. the card comes back: on the page

## BudgetFirst breaks
The shortest path has 5 steps:
0. not drawn yet
1. you break down the page: drawing
2. the call fails after spending: failed
3. you press Retry: redrawing
4. the call fails after spending: on the page, budget used up
5. you press Simpler: redrawing

## Rules that hold
NoDeadlock
