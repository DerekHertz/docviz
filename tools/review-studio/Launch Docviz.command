#!/bin/zsh -l
DOCVIZ_APP_ROOT="${0:A:h}"
cd "$DOCVIZ_APP_ROOT" || exit 1
if curl -fsS http://127.0.0.1:47836/api/bootstrap >/dev/null 2>&1; then
  open http://127.0.0.1:47836/
else
  if command -v node >/dev/null 2>&1; then
    node server.mjs --open
  elif [[ -x /usr/local/opt/node@22/bin/node ]]; then
    /usr/local/opt/node@22/bin/node server.mjs --open
  else
    print 'Node.js 22 or newer is needed to run Docviz.'
  fi
fi
