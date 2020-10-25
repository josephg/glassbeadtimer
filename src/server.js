const fs = require('fs')
const crypto = require('crypto')
const cookie = require('cookie')
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
  start_time: null,
  paused_progress: null,
  // _active_sessions: 0,
  // _locked_by: ...
})

const get_room = name => {
  name = name.toLowerCase()
  let r = rooms.get(name)
  if (r == null) {
    r = {
      clients: new Set(), // Set of asyncstreams.
      magister_id: null, // If set, cookie_id of the user who has ownership over the game.
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
  let magister_dirty = false
  // let dirty_clients = false
  const txn = {
    value: r.value,

    set(k, v) {
      patch[k] = v
      r.value[k] = v
    },
    reset_config() {
      const new_val = default_room_data(name)
      for (const k in new_val) {
        this.set(k, new_val[k])
      }
    },
    add_client(client) {
      // dirty_clients = true
      new_clients.push(client)
      patch._active_sessions = r.clients.size + new_clients.length
      // if (r.magister_id === client.cookie_id) update_magister = true
    },
    del_client(client) {
      // dirty_clients = true
      r.clients.delete(client)
      patch._active_sessions = r.clients.size + new_clients.length
      if (r.magister_id === client.cookie_id) {
        // Set the magister to be null, but only if the user doesn't have
        // another tab open.
        let found = false
        for (const c of r.clients) {
          if (c.cookie_id === client.cookie_id) found = true
        }
        if (!found) this.set_magister(null)
        // r.magister_id = null
        // update_magister = true
      }
    },
    set_magister(cookie_id) {
      r.magister_id = cookie_id
      magister_dirty = true
    }
  }

  fn && fn(txn)

  // console.log('appending val', patch)
  for (const c of r.clients) {
    if (magister_dirty) {
      c.stream.append({
        ...patch,
        _magister: r.magister_id == null ? null : c.cookie_id === r.magister_id
      })
    } else c.stream.append(patch)
  }

  for (const c of new_clients) {
    c.stream.append({
      ...r.value,
      _active_sessions: r.clients.size + new_clients.length,
      _magister: r.magister_id == null ? null : c.cookie_id === r.magister_id,
      _server_time: Date.now(),
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
  const client = {
    stream,
    cookie_id: req.cookie_id
  }
  // stream.append(get_room_snapshot(room))

  // r.clients.add(stream)
  update_room(room, txn => {
    txn.set('last_used', Date.now())
    txn.add_client(client)
  })

  res.once('close', () => {
    console.log('Closed connection to client for room', room)
    connected = false
    update_room(room, txn => {
      txn.set('last_used', Date.now())
      txn.del_client(client)
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
          case '_reset':
            txn.reset_config()
            break
          case '_magister': // Magister Ludi
            // console.log('setting magister', req.cookie_id)
            txn.set_magister(v ? req.cookie_id : null)
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
.use((req, res, next) => {
  // console.log('cookies', req.headers['cookie'])
  const cookies = cookie.parse(req.headers.cookie || '')
  // console.log('cookies', cookies.id)
  let id = cookies.id

  if (id == null) {
    id = crypto.randomBytes(12).toString('base64')
    // console.log('generated id', id)
    // Just using a session cookie
    res.setHeader('set-cookie', cookie.serialize('id', id, {
      httpOnly: true,
      sameSite: true,
    }))
  }

  req.cookie_id = id
  next()
})
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
        rooms.set(name, {clients: new Set(), magister: null, value})
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
  // save()
  process.exit()
})
process.on('SIGINT', () => {
  // save()
  process.exit()
})

process.on('uncaughtException', e => {
  console.error(e)
  process.exit(1)
})

process.on('unhandledRejection', e => {
  console.error(e)
  process.exit(1)
})

process.on('exit', () => {
  // console.log('exit')
  save()
})

