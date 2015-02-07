'use strict';

let express = require('express');
let app = express();
let bodyParser = require('body-parser');

app.use(bodyParser.json());
app.set('view engine', 'jade');

let folds = []; // Should save this out to a text file or whatever

app.get('/', function(req, res) {
  res.render('index', {folds: folds});
});

app.post('/fold', function(req, res) {
  folds.push(req.body.fold);
  res.sendStatus(200);
});

let server = app.listen(8080, function() {
  let a = server.address();
  console.log(`Listening on http://${a.address}:${a.port}`);
});
