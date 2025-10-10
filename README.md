# I am The Fold

Source for http://www.iamthefold.com

# TODO:

Backup data with:

```bash
$ upstash-redis-dump -db 0 -host HOST -port 6379 -pass PASS -tls > redis.dump
```
(you'll need the HOST & PASS from vercel)

Restore with:
```bash
$ redis-cli --pipe < redis.dump
```
