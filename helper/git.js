// The reviewed checkout is untrusted: git must not run its fsmonitor or hooks.
export const UNTRUSTED_GIT = ['-c', 'core.fsmonitor=', '-c', 'core.hooksPath=/dev/null'];
