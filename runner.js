'use strict';

var forever = require('forever-monitor');

var child = new(forever.Monitor)('index.js', {
  command: "iojs",
  silent: true,
  max: 5,
  killTree: true,
  minUptime: 2000,
  spinSleepTime: 1000,
  logFile: 'logs ' + new Date() + '.txt',
  outFile: 'out ' + new Date() + '.txt',
  errFile: 'err ' + new Date() + '.txt',
});

child.on('exit', function() {
  console.log('iamthefold has exited after 5000 restarts');
});

child.start();
