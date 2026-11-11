const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const mongoose = require('mongoose')

function load(file, imports = {}) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), {
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
function fixture() {
  const defaults = { type: 'NEW_MAP', category: 'roadtripeado', isRead: false, isArchived: false, readBy: [], archivedBy: [] }
  const before = new Date(user.createdAt.getTime() - 1)
  const rows = [
    { _id: 'old-broadcast', targetAudience: 'all_user', createdAt: before },
    { _id: 'old-interest', interests: ['hiking'], createdAt: before },
    { _id: 'new-broadcast', targetAudience: 'active_user', createdAt: user.createdAt },
    { _id: 'new-interest', interests: ['hiking'], createdAt: user.createdAt },
    { _id: 'personal', userId: user._id, createdAt: before, category: 'account' },
    { _id: 'other-user', userId: new mongoose.Types.ObjectId(), targetAudience: 'all_user', createdAt: user.createdAt },
    { _id: 'unrelated', interests: ['surfing'], createdAt: user.createdAt },
  ].map(row => ({ ...defaults, ...row }))
  const updates = []
  const chain = result => {
    const query = { lean: async () => result }
    for (const method of ['select', 'skip', 'limit', 'sort', 'populate']) query[method] = () => query
    return query
  }
  const Notification = {
    find: query => chain(rows.filter(row => matches(row, query))),
    countDocuments: async query => rows.filter(row => matches(row, query)).length,
    aggregate: async () => [],
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
  })
  return { service, updates }
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
