#!/bin/zsh -l
DOCVIZ_STUDIO_ROOT="${0:A:h}"
DOCVIZ_PROJECT_ROOT="${DOCVIZ_STUDIO_ROOT:h:h}"
export DOCVIZ_REVIEW_PORT=47840
export DOCVIZ_REVIEW_DATA="$DOCVIZ_PROJECT_ROOT/.scratch/review-studio"
cd "$DOCVIZ_STUDIO_ROOT" || exit 1
if curl -fsS http://127.0.0.1:47840/api/stacks >/dev/null 2>&1; then
  open http://127.0.0.1:47840/stack.html
else
  node --input-type=module -e 'import {startServer} from "./server.mjs"; await startServer({seed:false});' &
  DOCVIZ_STUDIO_PID=$!
  for attempt in {1..30}; do
    if curl -fsS http://127.0.0.1:47840/api/stacks >/dev/null 2>&1; then
      open http://127.0.0.1:47840/stack.html
      wait "$DOCVIZ_STUDIO_PID"
      exit
    fi
    sleep 0.2
  done
  print 'The local studio did not start. Inspect the server output above.'
  wait "$DOCVIZ_STUDIO_PID"
fi
