'use strict';

function drawFold(fold, current) {
  var child = document.createElement('li');
  if (typeof current === 'boolean' && current) {
    child.className = 'current';
  }
  var label = document.createElement('span');
  var inner = document.createTextNode(fold)
  child.setAttribute('style', 'top:' + fold + 'px');
  label.appendChild(inner);
  child.appendChild(label);
  ul.appendChild(child);
}

var sample = folds;
var ul = document.getElementsByTagName('ul')[0];
drawFold(fold, true);
sample.forEach(drawFold);

var work = require('work-token/async');

work.generate(challenge, strength, function(err, workToken) {
  if (err) {
    throw err;
  }
  var xhr = new XMLHttpRequest();
  var obj = {
    fold: fold,
    token: token,
    workToken: workToken
  };

  xhr.open('POST', '/fold', true);
  xhr.setRequestHeader('Content-type', 'application/json');
  xhr.send(JSON.stringify(obj));
});
