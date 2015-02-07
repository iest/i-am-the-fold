'use strict';

let express = require('express');
let app = express();

app.set('view engine', 'jade');

app.get('/', function(req, res) {
  res.render('index', {/*stuff in here*/});
});

let server = app.listen(8080, function() {
  let a = server.address();
  console.log(`Listening on http://${a.address}:${a.port}`);
});
