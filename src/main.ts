import App from './App.svelte';
import type { GameConfig, State } from './shared';

const path = window.location.pathname.split('/')
const room = path[path.length - 1]
console.log('room', room)

// This is pretty ghetto. To prevent bouncing I'm going to send an ID with each
// message, and ignore any message with this client's ID in the return path.
const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012345689'
const self_id = new Array(20).fill(null).map(() => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')

// This set of fields should have bind:input= instead of input= in App.svelte.
const debounced_fields = new Set(['topic', 'players', 'rounds', 'seconds_per_bead', 'seconds_between_bead'])

let state: State = {
  // room,
  // connection: 'loading',
  game_config: {
    state: 'loading',
    start_time: 0,
    meditate: false,
    contemplation: false,
    topic: '',
    players: 0,
    rounds: 0,
    paused_progress: 0,
    seconds_per_bead: -1,
    seconds_between_bead: 0,
  },
  _active_sessions: -1,
  _magister: null,
  _clock_offset: 0,
  _self_id: self_id
}

// const source = new EventSource('/events', { withCredentials: true })
const app = new App({
  target: document.body,
  props: {
    room,
    connection: 'loading',
    ...state
  }
})
;(window as any).app = app

const merge_config = (server_patch: any, is_bounce: boolean) => {
  for (const k in server_patch) {
    const v = server_patch[k]
    if (!is_bounce || !debounced_fields.has(k)) {
      ;(state.game_config as any)[k] = v
    }
  }
}

const merge = (server_patch: any) => {
  // console.log('server_patch', server_patch)
  let is_bounce = server_patch._id === self_id
  // console.log(server_patch._id, self_id)

  const local_patch: any = {}
  for (const k in server_patch) {
    const v = server_patch[k]
    if (k === 'game_config') {
      merge_config(v, is_bounce)
      local_patch[k] = state.game_config
    } else if (state[k as keyof State] !== v) {
      local_patch[k] = v
      ;(state as any)[k] = v
    }
  }
  console.log('merge', local_patch)
  // console.log('merge', server_patch)
  app.$set(local_patch)
}

// const eventsUrl = `${room}/events`
const eventsUrl = `${room}`
;(async () => {
  // let loaded = false
  while (true) {
    await new Promise<void>(resolve => {
      console.log('connecting...')
      const source = new EventSource(eventsUrl)
      app.$set({connection: 'connecting'})

      // source.addEventListener('message', message => {
      source.onopen = () => {
        console.log('OPEN')
        app.$set({connection: 'connected'})
      }
      source.onmessage = message => {
        
        const data = JSON.parse(message.data).data
        console.log('Got', data)
        
        if (data._server_time) {
          // Date.now() + offset = _server_time
          const offset = data._server_time - Date.now()
          if (offset > 800) {
            console.warn(`Clock skew detected of ${offset}ms`)
            data._clock_offset = offset
          }

          delete data._server_time
        }
        // app.$set(data)
        // setTimeout(() => merge(data), 1000)
        merge(data)
      }
      source.onerror = err => {
        console.error(err)
        console.log('readystate', source.readyState)
        
        // Ready state 0 means we're retrying anyway.
        if (source.readyState === 2) resolve()
        
        app.$set({connection: 'waiting'})
      }
    })
    
    await new Promise(res => setTimeout(res, 2000))
  }
})()