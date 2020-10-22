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

const update_room = (name, fn) => {
  const r = get_room(name)

  const patch = {}
  const new_clients = []
  // let dirty_clients = false
  const txn = {
    value: r.value,

    set(k, v) {
      patch[k] = v
      r.value[k] = v
    },
    add_client(client) {
      // dirty_clients = true
      new_clients.push(client)
      patch._active_sessions = r.clients.size + new_clients.length
    },
    del_client(client) {
      // dirty_clients = true
      r.clients.delete(client)
      patch._active_sessions = r.clients.size + new_clients.length
    }
  }

  fn && fn(txn)

  for (const c of r.clients) {
    // console.log('appending val', val)
    c.append(patch)
  }

  for (const c of new_clients) {
    c.append({
      ...r.value,
      _active_sessions: r.clients.size + new_clients.length
    })
    r.clients.add(c)
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
  // const r = get_room(room)
  const stream = asyncstream()
  // stream.append(get_room_snapshot(room))

  // r.clients.add(stream)
  update_room(room, txn => {
    txn.set('last_used', Date.now())
    txn.add_client(stream)
  })

  res.once('close', () => {
    console.log('closed')
    connected = false
    update_room(room, txn => {
      txn.set('last_used', Date.now())
      txn.del_client(stream)
    })
    stream.end()
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
  update_room(room, txn => {
    for (const k in parameters) {
      let v = parameters[k]
      const old_value = txn.value[k]
      // console.log('k', k, parameters[k])
      if (k.startsWith('_')) {
        // TODO: Reset
        switch (k) {
          case '_magister': // Magister Ludi
            console.log('setting magister', req.cookie_id)
            break;
          default:
            console.warn('Ignoring action', k)
        }
      } else if (old_value == null) {
        console.warn('Ignoring unknown parameter', k)
      } else if (v != null && old_value !== v) {
        // This is pretty dirty.
        if (typeof old_value === 'number' && typeof v === 'string') {
          v = v|0
        }
        
        if (k === 'state') {
          // TODO: Clean this up. Yikes.
          if (v === 'paused') {
            // ms since the game started.
            txn.set('paused_progress', Date.now() - txn.value.start_time)
          } else if (v === 'playing') {
            if (txn.value.paused_progress != null) {
              txn.set('start_time', Date.now() - txn.value.paused_progress)
              txn.set('paused_progress', null)
            } else txn.set('start_time', Date.now())

          } else if (v === 'waiting') {
            txn.set('start_time', null)
            txn.set('paused_progress', null)
          }
          console.log(`Game in room ${room} entered state ${v}`)
        }

        txn.set(k, v)
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