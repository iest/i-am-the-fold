'use strict';

let express = require('express');
let app = express();
let csrf = require('csurf');
let session = require('express-session');
let cookieParser = require('cookie-parser');
let bodyParser = require('body-parser');
let _ = require('underscore');
let fs = require('fs');
let async = require('async');

app.enable('trust proxy');
app.use(bodyParser.json());
app.use(cookieParser());
app.use(session({
  secret: process.env.SECRET,
  proxy: true,
}));

app.set('view engine', 'jade');
app.use(csrf());

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
  for (var i = 0; i < tasks.length; i++) {
    folds += tasks[i].fold + '\n';
  }
  fs.appendFile('folds.txt', folds);
  callback();
}, 5);

let blacklistCargo = async.cargo(function(tasks, callback) {
  let blacklist = "";
  for (var i = 0; i < tasks.length; i++) {
    blacklist += tasks[i].ip + '\n';
  }
  fs.appendFile('blacklist.txt', blacklist);
  callback();
}, 5);

let blacklist = fs
  .readFileSync('blacklist.txt', 'utf8')
  .split('\n');

app.use(function(err, req, res, next) {
  if (err.code !== 'EBADCSRFTOKEN') {
    return next(err);
  }
  res.status(403);
  res.send('session has expired or form tampered with');
});

app.get('/', function(req, res) {
  res.render('index', {
    folds: _.unique(folds),
    tallest: _.max(folds),
    csrfToken: req.csrfToken()
  });
});

app.post('/fold', function(req, res) {
  let fold = req.body.fold;
  let ip = req.ips[0];

  if (blacklist.indexOf(ip) !== -1) {
    console.log(`Fold already saved for IP: ${ip}`);
    return res.sendStatus(401);
  }

  if (
      !fold ||
      !Number(fold) ||
      parseInt(fold) > 5120 ||
      parseInt(fold) < 1
    ) {
    res.sendStatus(400);
    console.log(`Invalid fold: ${fold}`);
  } else {
    blacklist.push(ip);
    folds.push(fold);

    foldCargo.push({fold: fold}, function() {
      console.log("Wrote folds to disk");
    });
    blacklistCargo.push({ip: ip}, function() {
      console.log("Wrote blacklist to disk");
    });

    res.sendStatus(200);
    console.log(`Got new fold: ${fold} from ip ${ip}`);
  }
});

let server = app.listen(3333, function() {
  let a = server.address();
  console.log(`Listening on ${a.port}`);
});
