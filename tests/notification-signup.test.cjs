const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const mongoose = require('mongoose')

function load(file, imports = {}, source) {
  const exports = {}
  const code = ts.transpileModule(source || fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText
  vm.runInNewContext(code, { exports, require: name => imports[name] || {}, console, global: {} })
  return exports
}
const audience = load('src/enum/notification.ts')
const enums = load('src/modules/notification/notification.interface.ts', { '../../enum/notification': audience })
const userId = '000000000000000000000001'
const user = { _id: new mongoose.Types.ObjectId(userId), createdAt: new Date('2026-11-12T06:00:00Z'), interest: ['hiking'] }
const identity = { authId: userId, role: 'user' }
const same = (a, b) => String(a) === String(b)
function matches(row, query) {
  return Object.entries(query).every(([key, condition]) => {
    if (key === '$or') return condition.some(part => matches(row, part))
    if (key === '$and') return condition.every(part => matches(row, part))
    const value = row[key]
    const values = Array.isArray(value) ? value : [value]
    if (condition && typeof condition === 'object' && !(condition instanceof mongoose.Types.ObjectId)) {
      return Object.entries(condition).every(([operator, operand]) => {
        if (operator === '$exists') return (value !== undefined) === operand
        if (operator === '$ne') return !values.some(item => same(item, operand))
        if (operator === '$in') return values.some(item => operand.some(entry => same(item, entry)))
        if (operator === '$gte') return value >= operand
        throw new Error(`Unsupported operator ${operator}`)
      })
    }
    return values.some(item => same(item, condition))
  })
}
function fixture(options = {}) {
  const defaults = { type: 'NEW_MAP', category: 'roadtripeado', isRead: false, isArchived: false, readBy: [], archivedBy: [] }
  const before = new Date(user.createdAt.getTime() - 1)
  const rows = (options.rows || [
    { _id: 'old-broadcast', targetAudience: 'all_user', createdAt: before },
    { _id: 'old-interest', interests: ['hiking'], createdAt: before },
    { _id: 'new-broadcast', targetAudience: 'active_user', createdAt: user.createdAt },
    { _id: 'new-interest', interests: ['hiking'], createdAt: user.createdAt },
    { _id: 'personal', userId: user._id, createdAt: before, category: 'account' },
    { _id: 'other-user', userId: new mongoose.Types.ObjectId(), targetAudience: 'all_user', createdAt: user.createdAt },
    { _id: 'unrelated', interests: ['surfing'], createdAt: user.createdAt },
  ]).map(row => ({ ...defaults, ...row }))
  const updates = []
  const calls = { count: 0, aggregate: 0 }
  const chain = result => {
    const query = { lean: async () => result }
    for (const method of ['select', 'skip', 'limit', 'sort', 'populate']) query[method] = () => query
    return query
  }
  const Notification = {
    find: query => chain(rows.filter(row => matches(row, query))),
    countDocuments: async query => { calls.count++; return rows.filter(row => matches(row, query)).length },
    aggregate: async pipeline => {
      calls.aggregate++
      const group = pipeline.find(stage => stage.$group)?.$group
      if (!group) return []
      const valueOf = (expr, row) => {
        if (typeof expr === 'string' && expr.startsWith('$')) return row[expr.slice(1)] ?? null
        if (expr?.$ifNull) return expr.$ifNull.map(item => valueOf(item, row)).find(item => item != null) ?? null
        if (expr && typeof expr === 'object') return Object.fromEntries(Object.entries(expr).map(([key, value]) => [key, valueOf(value, row)]))
        return expr
      }
      const groups = new Map()
      for (const row of rows.filter(row => matches(row, pipeline[0].$match))) {
        const id = valueOf(group._id, row), key = JSON.stringify(id)
        if (!groups.has(key)) groups.set(key, { _id: id, count: 0 })
        groups.get(key).count++
      }
      return [...groups.values()]
    },
    updateMany: async (query, update) => {
      const selected = rows.filter(row => matches(row, query))
      updates.push(...selected.map(row => row._id))
      return { modifiedCount: selected.length }
    },
  }
  const { NotificationServices: service } = load('src/modules/notification/notification.service.ts', {
    './notification.interface': enums,
    './notification.model': { Notification },
    '../user/user.model': { User: { findById: () => chain(user) } },
    mongoose,
    'http-status-codes': { StatusCodes: {} },
    '../../errors/ApiError': class extends Error {},
    '../../helpers/paginationHelper': { paginationHelper: { calculatePagination: () => ({ page: 1, skip: 0, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' }) } },
  }, options.reference ? require('node:child_process').execFileSync('git', ['show', 'HEAD:src/modules/notification/notification.service.ts'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', windowsHide: true }) : undefined)
  return { service, updates, rows, calls }
}

test('new user lists exclude broadcasts before signup, retaining personal and matching new notifications', async () => {
  const { service } = fixture()
  for (const method of ['getMyNotifications', 'getAllNotifications']) {
    const result = await service[method](identity, {}, {})
    assert.deepEqual(Array.from(result.data, row => row._id).sort(), ['new-broadcast', 'new-interest', 'personal'])
    assert.equal(result.meta.total, 3)
  }
})

test('unread badge and user statistics use the same signup cutoff as the list', async () => {
  const { service } = fixture()
  const counts = await service.getUnreadCount(userId)
  assert.equal(counts.totalUnread, 3)
  assert.equal(counts.unreadAccount, 1)
  assert.equal(counts.unreadRoadtripeado, 2)
  const stats = await service.getNotificationStats(identity)
  assert.equal(stats.total, 3)
  assert.equal(stats.unread, 3)
})

test('mark-all and clear-all leave historical broadcasts and unrelated recipients untouched', async () => {
  for (const method of ['markAllAsRead', 'clearMyNotifications']) {
    const { service, updates } = fixture()
    await service[method](userId)
    assert.deepEqual(updates.sort(), ['new-broadcast', 'new-interest', 'personal'])
  }
})

test('admin global history remains available', async () => {
  const { service } = fixture()
  const result = await service.getAllNotifications({ ...identity, role: 'admin' }, {}, {})
  assert.equal(result.meta.total, 7)
})

test('optimized unread response equals the baseline while replacing four notification queries with one', async () => {
  const current = fixture(), previous = fixture({ reference: true })
  assert.deepEqual(JSON.parse(JSON.stringify(await current.service.getUnreadCount(userId))), JSON.parse(JSON.stringify(await previous.service.getUnreadCount(userId))))
  assert.deepEqual(current.calls, { count: 0, aggregate: 1 })
  assert.deepEqual(previous.calls, { count: 3, aggregate: 1 })
})

test('single unread aggregation preserves read/archive, legacy category/type and audience semantics', async () => {
  const rows = [
    { userId: user._id, category: 'account', type: 'A' },
    { userId: user._id, category: 'roadtripeado', type: 'A' },
    { userId: user._id, category: undefined, type: 'A' },
    { userId: user._id, category: null, type: null },
    { userId: user._id, type: undefined },
    { userId: user._id, isRead: true },
    { userId: user._id, isArchived: true },
    { targetAudience: 'all_user', createdAt: user.createdAt },
    { targetAudience: 'all_user', createdAt: user.createdAt, readBy: [user._id] },
    { targetAudience: 'all_user', createdAt: user.createdAt, archivedBy: [user._id] },
    { targetAudience: 'all_user', createdAt: new Date(0) },
    { userId: new mongoose.Types.ObjectId(), createdAt: user.createdAt },
  ]
  const a = fixture({ rows }), b = fixture({ rows, reference: true })
  const current = JSON.parse(JSON.stringify(await a.service.getUnreadCount(userId)))
  assert.deepEqual(current, JSON.parse(JSON.stringify(await b.service.getUnreadCount(userId))))
  assert.equal(current.totalUnread, 6)
  assert.equal(current.byType.A, 3)
  assert.equal(current.byType.null, 2)
  assert.deepEqual(JSON.parse(JSON.stringify(await fixture({ rows: [] }).service.getUnreadCount(userId))), { totalUnread: 0, unreadAccount: 0, unreadRoadtripeado: 0, byType: {} })
})

test('legacy array-valued categories retain the baseline category match semantics', async () => {
  const rows = [
    { userId: user._id, category: ['account', 'roadtripeado'], type: 'NEW_MAP' },
    { userId: user._id, category: ['account'], type: 'NEW_OFFER' },
    { userId: user._id, category: 'account', type: 'NEW_MAP' },
  ]
  const current = fixture({ rows }), previous = fixture({ rows, reference: true })
  assert.deepEqual(JSON.parse(JSON.stringify(await current.service.getUnreadCount(userId))), JSON.parse(JSON.stringify(await previous.service.getUnreadCount(userId))))
})
