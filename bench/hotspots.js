'use strict'
// Prints the functions with the most self time from a .cpuprofile directory.
const fs = require('fs')
const path = require('path')
const dir = process.argv[2]
const file = fs.readdirSync(dir).filter(f => f.endsWith('.cpuprofile')).map(f => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
const profile = JSON.parse(fs.readFileSync(file, 'utf8'))
const time = {}
profile.samples.forEach((id, i) => { time[id] = (time[id] ?? 0) + (profile.timeDeltas[i] ?? 0) })
const self = {}
for (const n of profile.nodes) {
  const key = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split(/[\/]/).slice(-2).join('/')}:${n.callFrame.lineNumber + 1}`
  self[key] = (self[key] ?? 0) + (time[n.id] ?? 0)
}
const total = Object.values(self).reduce((a, b) => a + b, 0)
for (const [k, v] of Object.entries(self).sort((a, b) => b[1] - a[1]).slice(0, Number(process.argv[3] ?? 25))) {
  console.log(`${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`)
}
