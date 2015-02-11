'use strict';

let crypto = require('crypto');
let express = require('express');
let app = express();
let bodyParser = require('body-parser');
let _ = require('underscore');
let fs = require('fs');
let async = require('async');
let st = require('st');
let jwt = require('jsonwebtoken');
let hashcache = require('./lib/hashcache');

let usedChallenges = new Set();

app.enable('trust proxy');
app.use(bodyParser.json());

app.set('view engine', 'jade');

// this determines how much work the clients must do per fold they submit
// anything above 3 will take a really long time to compute on typical computers
let strength = 3;

let folds = fs
  .readFileSync('folds.txt', 'utf8')
  .split('\n')
  .map(function(num) {
    return parseInt(num);
  })
  .filter(function(num) {
    return !Number.isNaN(num);
  });

let foldCargo = async.cargo(function(tasks, callback) {
  let folds = "";
  for (let i = 0; i < tasks.length; i++) {
    folds += tasks[i].fold + '\n';
  }
  fs.appendFile('folds.txt', folds);
  callback();
}, 5);

let blacklistCargo = async.cargo(function(tasks, callback) {
  let blacklist = "";
  for (let i = 0; i < tasks.length; i++) {
    blacklist += tasks[i].ip + '\n';
  }
  fs.appendFile('blacklist.txt', blacklist);
  callback();
}, 5);

let blacklist = fs
  .readFileSync('blacklist.txt', 'utf8')
  .split('\n');

function removeChallenge(challenge, timeout) {
  setTimeout(function() {
    usedChallenges.delete(challenge);
  }, timeout);
}

app.use(function(req, res, next) {
  if (req.body && req.body.token) {
    // if it's a POST, decode the challenge and verify that it was created by this server
    return jwt.verify(req.body.token, process.env.SECRET, function(err, token) {
      if (err && err.name === 'TokenExpiredError') {
        res.sendStatus(403);
        console.log("expired session");
        return;
      }
      if (err) {
        return next(err);
      }
      req.challenge = token.challenge;
      req.token = req.body.token;
      if (usedChallenges.has(req.challenge)) {
        res.sendStatus(403);
        console.log("challenge reuse rejected");
        return;
      }
      usedChallenges.add(req.challenge);
      // we only need to store used challenges for 2 minutes because
      // after that the session expires anyway
      removeChallenge(req.challenge, 2 * 60 * 1000);
      next();
    });
  }
  // generate a random challenge and sign that challenge to create a token
  crypto.randomBytes(50, function(err, buffer) {
    if (err) {
      return next(err);
    }
    req.challenge = buffer.toString('base64');
    req.token = jwt.sign({
      challenge: req.challenge
    }, process.env.SECRET, {
      expiresInMinutes: 2
    });
    next();
  });
});

app.get('/', function(req, res) {
  let sample = _.sample(folds, 1000);

  res.render('index', {
    folds: sample,
    tallest: _.max(sample),
    challenge: req.challenge,
    token: req.token,
    strength: strength
  });
});

app.post('/fold', function(req, res) {
  if (!hashcache.check(req.challenge, strength, req.body.workToken)) {
    res.sendStatus(403);
    console.log("Challenge failed");
    return;
  }
  
  let fold = req.body.fold;
  let ip = req.ips[0];

  if (blacklist.indexOf(ip) !== -1) {
    console.log(`Fold already saved for IP: ${ip}`);
    return res.sendStatus(401);
  }

  if (!fold ||
    !Number(fold) ||
    parseInt(fold) > 5120 ||
    parseInt(fold) < 1
  ) {
    res.sendStatus(400);
    console.log(`Invalid fold: ${fold}`);
  } else {
    blacklist.push(ip);
    folds.push(fold);

    foldCargo.push({
      fold: fold
    }, function() {
      console.log("Wrote folds to disk");
    });
    blacklistCargo.push({
      ip: ip
    }, function() {
      console.log("Wrote blacklist to disk");
    });

    res.sendStatus(200);
    console.log(`Got new fold: ${fold} from ip ${ip}`);
  }
});

app.use(st({
  path: __dirname + '/static',
  url: '/static'
}));
let server = app.listen(3333, function() {
  let a = server.address();
  console.log(`Listening on ${a.port}`);
});
