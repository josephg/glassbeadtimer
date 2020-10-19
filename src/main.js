import App from './App.svelte';

// let state = {
// 	connected: 'loading',
// 	value: null
// }


// const update_state = (txn) => {
// 	txn(state)
// 	// And re-render!
// 	app.$set(state)
// }
// export default app;

const path = window.location.pathname.split('/')
const room = path[path.length - 1]
console.log('room', room)

let state = {
	// room,
	// connection: 'loading',
	state: 'loading',
	start_time: 0,
	meditate: false,
	topic: '',
	players: 0,
	rounds: 0,
	paused_progress: 0,
	seconds_per_bead: -1,
	_active_sessions: -1,
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

const merge = server_patch => {
	const local_patch = {}
	for (const k in server_patch) {
		const v = server_patch[k]
		if (state[k] !== v) {
			local_patch[k] = v
			state[k] = v
		}
	}
	console.log('merge', local_patch)
	app.$set(local_patch)
}

const eventsUrl = `${room}/events`
;(async () => {
	// let loaded = false
  while (true) {
    await new Promise(resolve => {
      console.log('connecting...')
			const source = new EventSource(eventsUrl)
			app.$set({connection: 'connecting'})

      // source.addEventListener('message', message => {
      source.onopen = () => {
				console.log('OPEN')
				app.$set({connection: 'connected'})
			}
      source.onmessage = message => {
				// console.log('Got', message.data)
				
				const data = JSON.parse(message.data)
				// app.$set(data)
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