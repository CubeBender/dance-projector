'use strict';
// Photo import, judge overrides and serving through the output server.
const assert = require('assert');
const fs = require('fs'); const os = require('os'); const path = require('path'); const http = require('http');
const { Store } = require('../src/main/store');
const { OutputServer } = require('../src/main/server');
const { judgeView } = require('../src/main/view');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dp-store-'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const src = path.join(dir, 'face.png'); fs.writeFileSync(src, png);
const s = new Store(dir);
const name = s.importPhoto('90000001', src);
s.updateJudge('90000001', { displayName: 'Ing. Adam Testovací' });
s.flush();
const v = judgeView({ fedId: '90000001', letter: 'C', name: 'Adam', surname: 'Testovací', country: 'CZE' }, s);
assert.strictEqual(v.name, 'Ing. Adam Testovací'); assert.strictEqual(v.country, ''); assert.ok(v.photo.endsWith(name));
const s2 = new Store(dir); assert.strictEqual(s2.judge('90000001').photo, name, 'persisted');
const srv = new OutputServer({ outputsDir: path.join(__dirname, '..', 'src', 'outputs'), photoDir: s.photoDir });
srv.listen(0, '127.0.0.1').then(({ port }) => {
  const get = (p) => new Promise((r) => http.get(`http://127.0.0.1:${port}${p}`, (res) => { res.resume(); r(res.statusCode); }));
  Promise.all([get(v.photo), get('/photos/..%2F..%2Fconfig.json'), get('/out/heats.html'), get('/api/state')]).then(([a, b, c, d]) => {
    assert.strictEqual(a, 200); assert.notStrictEqual(b, 200, 'path traversal blocked'); assert.strictEqual(c, 200); assert.strictEqual(d, 200);
    s.removePhoto('90000001'); assert.ok(!s.judge('90000001').photo);
    console.log('OK'); srv.close(); process.exit(0);
  });
});
