const fs = require('fs')
const sirv = require('sirv')
const polka = require('polka')
const compress = require('compression')
const asyncstream = require('ministreamiterator')
const bodyParser = require('body-parser')
const randomWords = require('random-words')

// import sirv from 'sirv'
// import polka, { Middleware } from 'polka'
// import compress from 'compression'

const PORT = process.env.PORT || 3333
const SAVE_FILE = process.env.SAVE_FILE || 'rooms.json'

const ARCHETOPICS = [
  'Truth', 'Human', 'Energy', 'Beauty', 'Beginning', 'End', 'Birth', 'Death',
  'Ego', 'Attention', 'Art', 'Empathy', 'Eutopia', 'Future', 'Game', 'Gift',
  'History', 'Cosmos', 'Time', 'Life', 'Addiction', 'Paradox', 'Shadow', 'Society'
]

const rand_int = x => Math.floor(Math.random() * x)

// Map from room name => current room data.
const rooms = new Map()

const topic_from_name = name => {
  // We'll try and find an archetopic contained in the name.
  // name.
  if (name != null) {
    name = name.toLowerCase()
    for (let i = 0; i < ARCHETOPICS.length; i++) {
      if (name.indexOf(ARCHETOPICS[i].toLowerCase()) >= 0) return ARCHETOPICS[i]
    }
  }
  // Ok no good. Just return one at random.
  return ARCHETOPICS[rand_int(ARCHETOPICS.length)]
}

const default_room_data = name => ({
  state: 'waiting',
  meditate: true,

  // It might make sense to tuck these parameters.
  topic: topic_from_name(name),
  players: 2,
  rounds: 5,
  seconds_per_bead: 60,
  // _active_sessions: 0,
  // _locked_by: ...
})

const get_room = name => {
  name = name.toLowerCase()
  let r = rooms.get(name)
  if (r == null) {
    r = {
      clients: new Set(), // Set of asyncstreams.
      value: default_room_data(name)
    }
    rooms.set(name, r)
  }
  return r
}

const update_room = (name, txn) => {
  const r = get_room(name)
  txn && txn(r.value) // TODO: Light differential update here.
  const val = {
    ...r.value,
    _active_sessions: r.clients.size
  }

  for (const c of r.clients) {
    // console.log('appending val', val)
    c.append(val)
  }
}

const handle_events = async (req, res, parsed) => {
  const {room} = req.params
  console.log('Got client for room', room);
  // console.log(req.headers)

  res.writeHead(200, 'OK', {
    'Cache-Control': 'no-cache',
    'Content-Type': 'text/event-stream',
    'Connection': 'keep-alive'
  })

  // Tell the client to retry every second if connectivity is lost
  res.write('retry: 3000\n\n');
  let count = 0;

  let connected = true
  const r = get_room(room)
  const stream = asyncstream()
  r.clients.add(stream)
  update_room(room, r => r.last_used = Date.now())

  res.once('close', () => {
    console.log('closed')
    connected = false
    r.clients.delete(stream)
    stream.end()
    update_room(room, r => r.last_used = Date.now())
  })

  ;(async () => {
    // 30 second heartbeats to avoid timeouts
    while (true) {
      await new Promise(res => setTimeout(res, 30*1000))

      if (!connected) break
      
      // res.write(`event: heartbeat\ndata: \n\n`);
      res.write(`data: {}\n\n`)
      res.flush()
    }
  })()

  while (connected) {
    // await new Promise(resolve => setTimeout(resolve, 1000));

    // console.log('Emit', ++count);
    // Emit an SSE that contains the current 'count' as a string
    // res.write(`event: message\r\ndata: ${count}\r\n\r\n`);
    // res.write(`data: ${count}\nid: ${count}\n\n`);
    for await (const val of stream.iter) {
      // console.log('sending val', val)
      res.write(`data: ${JSON.stringify(val)}\n\n`)
      res.flush()
    }
  }
}

const handle_configure = (req, res) => {
  const {room} = req.params
  // If I was going to be strict about things, I'd do a proper parse and
  // whitelist of parameter types and all that. I'm not too worried about abuse
  // here.

  const parameters = req.body
  update_room(room, r => {
    for (const k in parameters) {
      let v = parameters[k]
      // console.log('k', k, parameters[k])
      if (r[k] == null) {
        console.warn('Ignoring unknown parameter', k)
      } else if (v != null && r[k] !== v) {
        // This is pretty dirty.
        if (typeof r[k] === 'number' && typeof v === 'string') {
          v = v|0
        }
        

        if (k === 'state') {
          if (v === 'paused') r.paused_progress = Date.now() - r.start_time
          else if (v === 'playing') {
            if (r.paused_progress != null) {
              r.start_time = Date.now() - r.paused_progress
              r.paused_progress = null
            } else r.start_time = Date.now() // TODO: Clean this up.

          } else if (v === 'waiting') {
            r.start_time = r.paused_progress = null
          }
          console.log(`Game in room ${room} entered state ${v}`)
        }

        if (k === '_reset') {
          // TODO.
        } else {
          r[k] = v
        }
      }
    }
  })
  
  res.end()
}


// Init `sirv` handler
const assets = sirv(__dirname + '/../public', {
  // maxAge: 31536000, // 1Y
  // immutable: true
  dev: process.env.NODE_ENV !== 'production'
});

polka()
.get('/rooms/_random', (req, res) => {
  let room, attempts = 0
  do { // Try to generate a room that doesn't exist.
    room = randomWords({exactly: 2, join: '-'})
  } while (rooms.has(room) && ++attempts < 20)

  res.writeHead(307, {
    location: room
  })
  res.end()
})
.get('/rooms/:room/events', handle_events)
.post('/rooms/:room/configure', bodyParser.json(), handle_configure)
// .use(assets)
.use(compress(), assets)
.get('/rooms/:room', sirv(__dirname + '/../public', {single: 'room.html'}))
// .use('/api', require('./api'))

.listen(PORT, err => {
  if (err) throw err;
  console.log(`Ready on localhost:${PORT}`);
})


const save = () => {
  const data = Array.from(rooms).map(([name, room]) => [name, room.value])
  // console.log('data', data)
  fs.writeFileSync(SAVE_FILE, JSON.stringify(data) + '\n')
  console.log('Game saved to', SAVE_FILE)
}

const load = () => {
  try {
    const rawData = fs.readFileSync(SAVE_FILE, 'utf8')
    const data = JSON.parse(rawData)
    for (const [name, value] of data) {
      // Gross. We should copy data in using the update_room method.
      // We'll discard any super old rooms.
      if (value.last_used > Date.now() - (1000 * 60 * 60 * 24 * 7)) {
        rooms.set(name, {clients: new Set(), value})
      } else {
        console.log('Discarding data for room', name)
      }
    }
    console.log(`Loaded old data for ${rooms.size} rooms`)
  } catch (e) {
    console.warn('Warning: All rooms emptied. Could not load previous data:', e.message)
  }
}
load()

process.on('SIGTERM', () => {
  save()
  process.exit()
})
process.on('SIGINT', () => {
  save()
  process.exit()
})