const fs = require('fs')
const crypto = require('crypto')
const cookie = require('cookie')
const sirv = require('sirv')
const polka = require('polka')
const compress = require('compression')
const asyncstream = require('ministreamiterator')
const bodyParser = require('body-parser')
const randomWords = require('random-words')
const accepts = require('accepts')

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

const log = (req, ...args) => {
  const reqIsReq = typeof req === 'object' && typeof req.connection === 'object'
  console.log(
    new Date().toISOString(),
    reqIsReq ? (req.headers['x-forwarded-for'] || req.connection.remoteAddress) : req,
    ...args
  )
}

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
  start_time: null,

  topic: topic_from_name(name),
  meditate: true,
  contemplation: true,
  players: 2,
  rounds: 5,
  seconds_per_bead: 60,
  seconds_between_bead: 0,
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
      game_config: default_room_data(name),
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
    game_config: r.game_config,

    set_raw(k, v) {
      patch[k] = v
      r[k] = v
    },
    set(k, v) {
      if (patch.game_config == null) patch.game_config = {}
      patch.game_config[k] = v
      r.game_config[k] = v
    },
    reset_config() {
      const new_val = default_room_data(name)
      for (const k in new_val) {
        this.set(k, new_val[k])
      }
    },
    set_source_id(id) {
      // id of client so that browser can ignore their own messages.
      patch._id = id
    },
    add_client(client) {
      // dirty_clients = true
      new_clients.push(client)
      patch._active_sessions = r.clients.size + new_clients.length
      // if (r.magister_id === client.cookie_id) update_magister = true
      log(`Room ${name} added client. Now ${patch._active_sessions} clients`)
    },
    del_client(client) {
      // dirty_clients = true
      r.clients.delete(client)
      patch._active_sessions = r.clients.size + new_clients.length
      log(`Room ${name} removed client. Now ${patch._active_sessions} clients`)
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
      log(`Room ${name} set magister to ${cookie_id}`)
    }
  }

  fn && fn(txn)

  // console.log('appending val', patch)
  for (const c of r.clients) {
    if (magister_dirty) {
      c.stream.append({
        data: {
          ...patch,
          _magister: r.magister_id == null ? null : c.cookie_id === r.magister_id
        }
      })
    } else c.stream.append({data: patch})
  }

  for (const c of new_clients) {
    c.stream.append({
      headers: {
        'x-braid-version': '0.1',
        'content-type': 'application/json',
        'x-patch-type': 'update-keys'
      },
      data: {
        game_config: r.game_config,
        _active_sessions: r.clients.size + new_clients.length,
        _magister: r.magister_id == null ? null : c.cookie_id === r.magister_id,
        _server_time: Date.now(),
      }
    })
    r.clients.add(c)
  }
}

const handle_events = async (req, res) => {
  const {room} = req.params
  log(req, 'Got client for room', room)
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
    log(req, 'Closed connection to client for room', room)
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
      
      res.write(`event: heartbeat\ndata: \n\n`);
      // res.write(`data: {}\n\n`)
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
      const old_value = txn.game_config[k]
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
          case '_id':
            txn.set_source_id(v)
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
            txn.set('paused_progress', Date.now() - txn.game_config.start_time)
          } else if (v === 'playing') {
            if (txn.game_config.paused_progress != null) {
              txn.set('start_time', Date.now() - txn.game_config.paused_progress)
              txn.set('paused_progress', null)
            } else txn.set('start_time', Date.now())

          } else if (v === 'waiting') {
            txn.set('start_time', null)
            txn.set('paused_progress', null)
          }
          log(req, `Game in room ${room} entered state ${v}`)
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
.get('/rooms/:room', (req, ...args) => {
  // console.log('get', req.accepted)
  accepts(req).type('text/html')
    ? sirv(__dirname + '/../public', {single: 'room.html'})(req, ...args)
    : handle_events(req, ...args)
})
.get('/:room', (req, res) => {
  // Redirect to /rooms/room
  res.writeHead(302, {
    'location': `/rooms/${req.params.room}`
  })
  res.end()
  //.redirect(`/rooms/${req.params.room}`)
})
// .use('/api', require('./api'))

.listen(PORT, err => {
  if (err) throw err;
  console.log(`Ready on localhost:${PORT}`);
})


const save = () => {
  const data = Array.from(rooms).map(([name, room]) => [name, room.game_config])
  // console.log('data', data)
  fs.writeFileSync(SAVE_FILE, JSON.stringify(data) + '\n')
  console.log('Game saved to', SAVE_FILE)
}

const load = () => {
  try {
    const rawData = fs.readFileSync(SAVE_FILE, 'utf8')
    const data = JSON.parse(rawData)
    for (const [name, game_config] of data) {
      // Gross. We should copy data in using the update_room method.
      // We'll discard any super old rooms.
      if (game_config.last_used > Date.now() - (1000 * 60 * 60 * 24 * 7)) {
        rooms.set(name, {
          clients: new Set(),
          magister: null,
          game_config: {
            ...default_room_data(),
            ...game_config
          }
        })
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

