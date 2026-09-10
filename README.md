# I am The Fold

Source for http://www.iamthefold.com

Run `npm test`, `npm run lint`, and `npx tsc --noEmit --incremental false` to
check changes. Tests use fake credentials and never connect to the live database.
The atomic-write integration test starts an isolated Redis server on a Unix
socket; install `redis-server` locally to run it (otherwise that test is skipped).
