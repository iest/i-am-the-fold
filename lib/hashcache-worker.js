'use strict';

var hashcache = require('./hashcache');

self.addEventListener('message', function(e) {
  self.postMessage({
    id: e.data.id,
    result: hashcache[e.data.method].apply(hashcache, e.data.args)
  });
}, false);
