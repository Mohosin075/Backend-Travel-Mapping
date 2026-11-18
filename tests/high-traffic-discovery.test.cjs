const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const plain = value => JSON.parse(JSON.stringify(value));
const baseline = require('node:child_process').execFileSync('git', ['show', 'HEAD:src/modules/map/map.service.ts'], { cwd: root, encoding: 'utf8', windowsHide: true });
function load(file, imports = {}, source) {
  const m = { exports: {} };
  vm.runInNewContext(ts.transpileModule(source || fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText, { module: m, exports: m.exports, require: name => imports[name] || {}, console });
  return m.exports;
}
const privacy = load('src/helpers/placePrivacy.ts');

function service(source, places, businesses) {
  const query = rows => {
    let limit = Infinity;
    const q = { then: (resolve, reject) => Promise.resolve(rows.slice(0, limit)).then(resolve, reject), limit: value => { limit = value; return q; } };
    for (const method of ['select', 'populate', 'lean']) q[method] = () => q;
    return q;
  };
  class QueryBuilder {
    constructor(modelQuery) { this.modelQuery = modelQuery; }
    search() { return this; } filter() { return this; } sort() { return this; }
  }
  return load('src/modules/map/map.service.ts', {
    '../../builder/QueryBuilder': QueryBuilder,
    '../place/place.model': { Place: { find: () => query(structuredClone(places)) } },
    '../business/business.model': { Business: { find: () => query(structuredClone(businesses)) } },
    '../../helpers/placePrivacy': privacy,
  }, source).MapService;
}

const places = [
  { _id: 'locked', name: { en: 'Secret shore', es: 'Costa secreta' }, type: 'Regular', map: 'paid', category: 'beach', media: ['preview.jpg'], location: { coordinates: [-66, 18], mapLocation: { coordinates: [-66, 18] } }, description: 'PAID DETAIL', privateInfo: 'PRIVATE', rating: 4 },
  { _id: 'owned', name: { en: 'Owned beach', es: 'Playa comprada' }, type: 'Regular', map: 'owned', media: [], location: { coordinates: [-65, 18] }, description: 'owned details', rating: 3 },
  { _id: 'accent', name: { en: 'Café Uno', es: 'Café Uno' }, type: 'Business', map: 'paid', category: 'cafe', media: [], location: { coordinates: [-64, 18] }, rating: 5 },
  { _id: 'duplicate', name: 'CAFE UNO', type: 'Regular', map: 'paid', media: [], location: { coordinates: [-64, 18] } },
  { _id: 'free', name: 'Free waterfall', type: 'Regular', map: 'free', media: ['free.jpg'], location: { coordinates: [-63, 18] }, description: 'free details', rating: 2 },
  { _id: 'missing-map', name: 'Unassigned', type: 'Regular', media: [], location: { coordinates: [-62, 18] } },
  { _id: 'no-coordinates', name: 'No coordinates', type: 'Regular', map: 'free', media: [], rating: 1 },
];
const businesses = [
  { _id: 'cafe', name: { en: 'Cafe Uno', es: 'Cafe Uno' }, media: { photos: ['cafe.jpg'] }, location: { mapLocation: { coordinates: [-64, 18] }, country: 'PR' }, rating: 4 },
  { _id: 'cafe-copy', name: 'café uno', media: { photos: [] }, location: { mapLocation: { coordinates: [-64, 18] } } },
  { _id: 'other', name: 'Other business', category: 'food', media: { photos: [] }, location: { mapLocation: { coordinates: [-61, 18] } }, rating: 2 },
];

for (const [label, staff, editorIds, lockedIds] of [
  ['guest', false, undefined, ['paid', 'owned']],
  ['purchaser', false, undefined, ['paid']],
  ['admin', true, undefined, []],
  ['map editor', true, ['owned'], ['paid', 'free']],
]) {
  for (const query of [{ limit: 1000 }, { limit: 2, page: 2 }, { limit: 1000, sort: '-rating' }, { limit: 1000, searchTerm: 'cafe' }]) {
    test(`discovery memoization preserves the complete ${label} result for ${JSON.stringify(query)}`, async () => {
      const before = await service(baseline, places, businesses).getDiscoveryData(query, lockedIds, staff, undefined, editorIds);
      const after = await service(undefined, places, businesses).getDiscoveryData(query, lockedIds, staff, undefined, editorIds);
      assert.deepEqual(plain(after), plain(before));
      if (!staff && query.limit === 1000) {
        const locked = after.data.find(row => row._id === 'locked');
        assert.equal(locked.isLocked, true);
        assert.equal(locked.description, undefined);
        assert.equal(locked.privateInfo, undefined);
        assert.deepEqual(Array.from(locked.media), ['preview.jpg']);
      }
    });
  }
}

test('request-local normalization does not retain a previous request name or access state', async () => {
  const shared = service(undefined, places, businesses);
  const guest = await shared.getDiscoveryData({ limit: 1000 }, ['owned'], false);
  const owner = await shared.getDiscoveryData({ limit: 1000 }, [], false);
  assert.equal(guest.data.find(row => row._id === 'owned').description, undefined);
  assert.equal(owner.data.find(row => row._id === 'owned').description, 'owned details');
});

test('empty discovery results retain pagination and response shape', async () => {
  assert.deepEqual(plain(await service(undefined, [], []).getDiscoveryData({ limit: 1000 }, [])), plain(await service(baseline, [], []).getDiscoveryData({ limit: 1000 }, [])));
});
