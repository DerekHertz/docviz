// The reader's words for the MVP flow.
export const title = "One PR, from the agent's branch to merge";
const words = { needs: "needs you", look: "look when you can", nothing: "nothing for you" };
export const state = (v) => {
  if (v.phase === "writing") return v.rounds ? "agent fixing" : "agent writing";
  if (v.phase === "checked") return `checked: ${words[v.verdict]}`;
  if (v.phase === "open") return "PR open";
  if (v.phase === "verified") return "verified";
  if (v.phase === "held") return "held for you";
  return "merged";
};
const labels = {
  AgentChecks: "the agent runs docviz",
  AgentEditsRules: null,
  AgentFixes: "the agent fixes the code [rounds left]",
  AgentOpensPR: "the agent opens the PR",
  VerifierRuns: "a second agent reruns docviz",
  AgentPushesAgain: "a new commit lands",
  Merge: "merged",
  Done: null,
};
export const step = (action, from, to) => {
  if (action === "VerifierRuns") return to.phase === "verified" ? "a second agent agrees" : "it disagrees, or needs you";
  if (action === "AgentOpensPR" && from.verdict === "needs") return "the agent opens it flagged [2 rounds used]";
  return labels[action] ?? action;
};
export const group = (v) => (v.phase === "merged" ? "done" : v.phase === "held" ? "you" : "agents");
export const colors = { agents: "blue", you: "orange", done: "teal" };
