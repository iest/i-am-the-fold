'use strict';

var worker = new Worker('/static/hashcache-worker.js');

var id = 0;
var callbacks = {};
worker.addEventListener('message', function (e) {
  if (callbacks[e.data.id]) {
    callbacks[e.data.id](null, e.data.result);
    delete callbacks[e.data.id];
  }
});

exports.generate = function (challenge, strength, callback) {
  callbacks[id] = callback;
  worker.postMessage({
    id: id,
    method: 'generate',
    args: [challenge, strength]
  });
  id++;
};
exports.check = function (challenge, strength, token, callback) {
  callbacks[id] = callback;
  worker.postMessage({
    id: id,
    method: 'check',
    args: [challenge, strength, token]
  });
  id++;
};
