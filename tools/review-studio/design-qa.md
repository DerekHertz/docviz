# GitHub extension QA

Final result: passed for the installed desktop PR workflow.

Tested in native Chrome on actual Docviz PR #10, signed in, GitHub Preview UI, dark GitHub host and sage/serif extension frame. Screenshots are 1832 × 1860 physical pixels (916 × 930 logical). Reviewed the visible typography, property bubbles, sequential path, evidence labels, agent reasoning, source pane, modal headers, and navigation controls.

Three defects were fixed and retested after extension reload: source focus scrolled the outer dialog; attaching inside the responsive PR tabs hid the entry and crowded native tabs; the sticky GitHub toolbar could cover the panel header. The revised entry sits below intact native navigation, source scrolling stays inside its pane, and opening reserves 72px of toolbar clearance.

Before/after captures: `../docviz-github-source-scroll-before.png` and `../docviz-github-source-scroll-fixed.png`; `../docviz-github-entry-before.png` and `../docviz-github-entry-fixed.png`. Final installed captures: `../docviz-github-agent-reasoning-tested.png`, `../docviz-github-verification-tested.png`.

Component → property → evidence/source → agent reasoning navigation works through the real worker and local engine. Return to GitHub works; reopening retains the selected property. No review decisions were changed. All 20 automated checks passed.

This gate covers desktop PR use. Installed comparison-page navigation, private repository authentication and mobile layout remain unverified. The next behavior-animation design requires its own verification.
