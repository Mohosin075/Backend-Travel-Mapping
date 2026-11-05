const fs = require('node:fs')
const path = require('node:path')
const mongoose = require('mongoose')

// Confirmed through the live public maps API. Never broaden this repair to other maps.
const MAP_ID = '69e912c3668604cc97522d2a'
async function repairCountry(db, { apply = false, backup } = {}) {
  const maps = db.collection('maps')
  const _id = new mongoose.Types.ObjectId(MAP_ID)
  const map = await maps.findOne({ _id }, { projection: { name: 1, country: 1 } })
  if (!map) throw Error('The exact Puerto Rico map was not found; no changes made.')
  const names = typeof map.name === 'string' ? [map.name] : [map.name?.en, map.name?.es]
  if (!names.some(name => typeof name === 'string' && name.trim().toLowerCase() === 'puerto rico')) {
    throw Error('Map name no longer matches Puerto Rico; no changes made.')
  }
  if (map.country === 'Puerto Rico') return { action: 'already_correct', id: MAP_ID }
  if (map.country !== 'Bangladesh') throw Error('Country changed since diagnosis; no changes made.')
  const change = { id: MAP_ID, name: map.name, from: map.country, to: 'Puerto Rico' }
  if (!apply) return { action: 'would_update', ...change }
  if (typeof backup !== 'function') throw Error('A backup writer is required before applying this repair.')
  await backup(change)
  const result = await maps.updateOne({ _id, name: map.name, country: 'Bangladesh' }, { $set: { country: 'Puerto Rico' } })
  if (result.modifiedCount !== 1) throw Error('The map changed concurrently; correction was not applied.')
  const updated = await maps.findOne({ _id }, { projection: { country: 1 } })
  if (updated?.country !== 'Puerto Rico') throw Error('Unable to verify the updated country.')
  return { action: 'updated', ...change }
}

async function main() {
  require('dotenv').config({ path: path.join(process.cwd(), '.env'), quiet: true })
  if (!process.env.DATABASE_URL) throw Error('DATABASE_URL is required.')
  try {
    await mongoose.connect(process.env.DATABASE_URL, { serverSelectionTimeoutMS: 10000 })
    const result = await repairCountry(mongoose.connection.db, {
      apply: process.argv.includes('--apply'),
      backup: change => {
        const filename = `puerto-rico-country-backup-${Date.now()}.json`
        fs.writeFileSync(path.join(process.cwd(), filename), JSON.stringify({ database: mongoose.connection.name, ...change }, null, 2), { flag: 'wx' })
      },
    })
    console.log(JSON.stringify({ database: mongoose.connection.name, ...result }, null, 2))
  } finally { await mongoose.disconnect() }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1 })
module.exports = { repairCountry, MAP_ID }
