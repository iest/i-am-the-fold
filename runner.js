'use strict';

var forever = require('forever-monitor');

var child = new(forever.Monitor)('index.js', {
  command: "iojs",
  args: ['index.js'],
  max: 5,
  silent: true,
  'logFile': 'logs.txt',
  'outFile': 'out.txt',
  'errFile': 'err.txt',
});

child.on('exit', function() {
  console.log('iamthefold has exited after 5 restarts');
});

child.start();
