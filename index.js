'use strict';

let express = require('express');
let app = express();
let bodyParser = require('body-parser');
let _ = require('underscore');
let fs = require('fs');

app.use(bodyParser.json());
app.set('view engine', 'jade');

let folds = _(fs
  .readFileSync('folds.txt', 'utf8')
  .split('\n')
  .map(function(num) {
    return parseInt(num);
  })
  .filter(function(num) {
    return !Number.isNaN(num);
  })).sample(200);

app.get('/', function(req, res) {
  res.render('index', {
    folds: _.unique(folds),
    tallest: _.max(folds)
  });
});

app.post('/fold', function(req, res) {
  let fold = req.body.fold;

  if (!fold || !Number(fold) || parseInt(fold) > 1e6) {
    res.sendStatus(400);
  } else {
    folds.push(fold);
    fs.appendFile('folds.txt', fold + '\n');
    res.sendStatus(200);
  }
});

let server = app.listen(process.env.PORT || 8080, function() {
  let a = server.address();
  console.log(`Listening on http://${a.address}:${a.port}`);
});
