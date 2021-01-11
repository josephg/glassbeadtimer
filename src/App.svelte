<script>
import * as topicIcons from './topics.json'

export let room

export let connection

export let game_config
// export let state // loading, waiting, playing, paused.
// export let start_time
// export let topic
// export let meditate
// export let players
// export let rounds
// export let seconds_per_bead
// export let paused_progress

export let _active_sessions
export let _magister
export let _clock_offset

// let game_completed = false // Derived from other properties

let round_audio
let complete_audio
let topic_img

let state
$: state = game_config.state

$: console.log('Game configuration changed', game_config)

	// export let state

const ARCHETOPICS = [
  'Truth', 'Human', 'Energy', 'Beauty', 'Beginning', 'End', 'Birth', 'Death',
  'Ego', 'Attention', 'Art', 'Empathy', 'Eutopia', 'Future', 'Game', 'Gift',
  'History', 'Cosmos', 'Time', 'Life', 'Addiction', 'Paradox', 'Shadow', 'Society'
]

$: {
	if (topic_img) {
		const svgContent = topicIcons[game_config.topic.toLocaleLowerCase()]
		if (svgContent) topic_img.innerHTML = svgContent
	}
}

// Could make configurable. Eh.
const MEDITATION_SECONDS = 60

let game_stages = []
$: {
	game_stages = [{
		label: `${game_config.meditate ? 'Meditation' : 'Game'} is about to start`,
		duration: 3,
		no_sound: true
	}]
	if (game_config.meditate) game_stages.push({
		label: 'Meditate',
		type: 'meditate',
		duration: MEDITATION_SECONDS,
	})
	for (let r = 0; r < game_config.rounds; r++) {
		for (let p = 0; p < game_config.players; p++) {
			game_stages.push({
				label: game_config.players > 1 ? `Round ${r+1} player ${p+1}` : `Round ${r+1}`,
				duration: game_config.seconds_per_bead,
				type: 'bead', r, p
			})
		}
	}
}

// TODO: The protocol for these update methods doesn't use game_state properly.
const update_state = async patch => {
	await fetch(`${room}/configure`, {
		method: 'POST',
		mode: 'same-origin',
		headers: {
			'content-type': 'application/json',
		},
		body: JSON.stringify(patch)
	})
}

const upd = (k, v) => () => update_state({[k]: v})

const config = k => e => {
	// console.log('k', k, e.data, e.value, e.target.value, e.target.type)
	const raw_value = e.target.value
	const value = e.target.type === 'number' ? raw_value|0
		: e.target.type === 'checkbox' ? e.target.checked
		: raw_value
	update_state({[k]: value})
}

const roundish = x => Math.round(x * 10) / 10


const waiting_stage = { label: 'Waiting for game to start', duration: Infinity }
const complete_stage = { label: 'Game complete', type: 'complete' }
const get_current_stage = (offset_ms) => {
	if (state === 'waiting') return {stage: waiting_stage, offset_ms: 0}

	let offset_sec = Math.round(offset_ms / 1000)
	for (let s = 0; s < game_stages.length; s++) {
		let stage = game_stages[s]
		if (stage.duration > offset_sec) {
			return {stage, offset_sec}
		}
		offset_sec -= stage.duration
	}
	return {
		stage: complete_stage, offset_sec
	}
}

let current_stage = null, offset_sec
$: console.log('current stage', current_stage)


const tick = (play_audio) => {
	// console.log('tick')
	// console.log('state', state, 'completed', state && state.complete)

	const time = state === 'playing' ? Date.now() + _clock_offset - game_config.start_time
		: state === 'paused' ? game_config.paused_progress
		: 0
	const {stage: new_stage, offset_sec: new_offs} = get_current_stage(time)
	// state_label = state.label
	
	offset_sec = new_offs
	if (new_stage !== current_stage) {
		console.log('state changed', new_stage.label, new_stage.type === 'complete')
		current_stage = new_stage
		// completed = new_game_state.complete
		// if (!state.complete) round_audio.play()

		if (play_audio && !new_stage.no_sound) {
			if (current_stage.type === 'complete') complete_audio.play()
			else round_audio.play()
		}
	}
}

let timer
$: {
	// Sadly we can't use internal_state here because it generates a cyclic dependancy.
	let completed = current_stage ? current_stage.type === 'complete' : false
	// console.log('xx', state, timer, completed, current_stage)

	// if (state !== 'loading') tick(false)

	if (state === 'playing' && timer == null && !completed) {
		// setTimeout needed to get around some weird race condition.
		// There's probably better ways to structure this :/
		setTimeout(() => tick(false))
		timer = setInterval(() => {
			tick(true)
		}, 1000)
	} else if ((completed || state !== 'playing') && timer != null) {
		console.log('cancelled interval timer')
		clearInterval(timer)
		timer = null
	} else if (state === 'waiting' || state === 'paused') {
		setTimeout(() => tick(false))
	}
}

let game_completed
$: {
	// console.log('updating game_completed', current_stage)
	game_completed = (state !== 'playing' || current_stage == null) ? false
	: (current_stage.type === 'complete')
}

let internal_state
$: internal_state = game_completed ? 'completed' : state

let bar_width = 0
$: bar_width = current_stage == null ? 0
	: state === 'waiting' ? 0
	: current_stage.type === 'complete' ? 100
	: 100 * offset_sec / current_stage.duration

let stage_label
$: stage_label = internal_state === 'waiting' ? 'Waiting for game to start'
	: current_stage == null ? 'unknown' : current_stage.label

const order = ['meditate', 'bead', 'complete']
const class_for = x => x < 0 ? 'done'
	: x > 0 ? 'waiting'
	: 'active'

const progress_class = (stage, type, r, p) => {
	if (stage == null) return ''

	const current_o = order.indexOf(stage.type)
	const element_o = order.indexOf(type)

	// const o_diff = element_o - current_o
	return type === 'bead' && stage.type === 'bead'
		? (r === stage.r ? class_for(p - stage.p) : class_for(r - stage.r))
		: class_for(element_o - current_o)
}

// This will get more complex in time. For now, pause the game to fiddle.
$: settings_disabled = state === 'playing'

let config_open = false

$: if (_magister === true) config_open = true

// The first user has the config open by default.
// $: if (_active_sessions === 1) config_open = true

// The magister box is fully visible once there's a critical mass of players in the room
$: magister_opaque = _magister === true || _active_sessions >= 6

</script>

<svelte:head>
	{#if _magister}
		<style>
body {
	background-color: var(--bg-highlight);
}
		</style>
	{/if}
</svelte:head>

<!-- <main class:magister={_magister}> -->
<main>
	<audio bind:this={round_audio} src="/lo-metal-tone.mp3" preload="auto"><track kind="captions"></audio>
	<audio bind:this={complete_audio} src="/hi-metal-tone.mp3" preload="auto"><track kind="captions"></audio>

	{#if internal_state === 'loading'}
		<h1>Loading game state</h1>
	{:else}
		<!-- <h1>Glass Bead Game Timer</h1> -->
		<!-- <h1>{topic}</h1> -->

		<div id='topicimg' bind:this={topic_img}>{game_config.topic}</div>

		<h1>{stage_label}</h1>
		<div id='progresscontainer'>
			<div id='progress_time'>{((internal_state === 'playing' || internal_state === 'paused') && current_stage) ? current_stage.duration - offset_sec : ''}</div>
			<div id='progress' style='width: {bar_width}%'></div>
		</div>

		{#if (_magister == null || _magister == true)}
			{#if internal_state == 'waiting'}
				<button on:click={upd('state', 'playing')}>Start</button>
			{:else if internal_state == 'playing'}
				<button on:click={upd('state', 'paused')}>Pause</button>
			{:else if internal_state == 'paused'}
				<button on:click={upd('state', 'playing')}>Resume</button>
			{/if}
		{/if}

		<div style='height: 400px;'></div>

		<details>
			<!-- I'm not ready to delete these UI elements but we might not use them -->
			<summary>Info</summary>

			<h1>{game_config.topic}</h1>
			<h4>Room: <em>{room}</em> <a href="../..">(leave)</a></h4>

			<div>
				{state === 'waiting' ? 'Waiting for the game to start'
				: state === 'paused' ? 'GAME PAUSED'
				: state === 'playing' ? 'Game in progress'
				: ''}
			</div>
			{#if connection !== 'connected'}
				<div>DISCONNECTED FROM GAME SERVER</div>
			{:else}
				{#if _active_sessions == 1}
					<div>You are alone in the room</div>
				{:else}
					<div>{_active_sessions} players are in this room</div>
				{/if}
			{/if}
	
			<div id='rounds'>
				<h2>Game</h2>
				{#if game_config.meditate}
					<div>
						<span class={progress_class(current_stage, 'meditate')}>Meditation (1 min)</span>
					</div>
				{/if}
				{#each Array(Math.max(game_config.rounds, 0)) as _, r}
					<div>Round {r+1}:
						{#each Array(Math.max(game_config.players, 0)) as _, p}
							<span class={'bead ' + progress_class(current_stage, 'bead', r, p)}>{p+1} </span>
						{/each}
					</div>
				{/each}
			</div>
	
		</details>

		{#if _magister == null || _magister == true}
			<details class='config' bind:open={config_open}>
				<summary>Game controls</summary>

				<p>
					{#if _magister == null}
						This will effect all players. Will you borrow power? Will you steal it?
					{:else}
						You are master of the games. These controls are yours alone.
					{/if}
				</p>

				{#if internal_state == 'waiting'}
					<button on:click={upd('state', 'playing')}>Start</button>
				{:else if internal_state == 'playing'}
					<button on:click={upd('state', 'paused')}>Pause</button>
				{:else if internal_state == 'paused'}
					<button on:click={upd('state', 'playing')}>Resume</button>
				{/if}

				{#if internal_state == 'paused' || internal_state == 'completed' }
					<button on:click={upd('state', 'waiting')}>Restart game</button>
				{/if}

				<label>
					<span>Topic</span>
					<input disabled={settings_disabled} type='text' value={game_config.topic} on:input={config('topic')} list='archetopics' >
					<datalist id='archetopics'>
						{#each ARCHETOPICS as topic}
							<option value={topic}>
						{/each}
					</datalist>
				</label>

				<label>
					<span>Pre-game meditation</span>
					<input disabled={settings_disabled} type='checkbox' checked={game_config.meditate} on:input={config('meditate')} >
				</label>

				<label>
					<span>Number of players</span>
					<input disabled={settings_disabled} type='number' pattern='[0-9]*' value={game_config.players} on:input={config('players')} min=1 max=12 >
				</label>

				<label>
					<span>Number of rounds</span>
					<input disabled={settings_disabled} type='number' pattern='[0-9]*' value={game_config.rounds} on:input={config('rounds')} min=1 max=20>
				</label>

				<label>
					<span>Seconds per bead</span>
					<input disabled={settings_disabled} type='number' pattern='[0-9]*' value={game_config.seconds_per_bead} on:input={config('seconds_per_bead')}>
				</label>

				<div style='margin-top: 1em;'>
					(Total game length: {roundish(
						game_stages.reduce((x, s) => x + s.duration, 0) / 60
					)} minutes)
				</div>

				<div id='magister_box' class:magister_opaque>
					{#if _magister == null}
						<button on:click={upd('_magister', true)}>Assume the mantle of Magister Ludi</button>
						<p><i>Advanced - for large games</i></p>
						<p>When present, the Magister Ludi (master of the games) has exclusive control of the game.</p>
					{:else if _magister == true}
						<button on:click={upd('_magister', null)}>Abdicate Magister Ludi status</button>
						<p>You are the master of the games. You have exclusive control over playing, pausing and configuring this game.</p>
						<p>Do not close this browser window or you will be dethroned.</p>
					{/if}
				</div>
			</details>
		{:else}
			<p class='config'>Magister Ludi is managing this game.</p>
		{/if}
	{/if}
</main>

<style>

main {
	/* margin-bottom: 3em; */
	text-align: center;
}

#topicimg {
	width: 300px;
	display: inline-block;
}

.magister {
	background-color: var(--bg-highlight);
}

h1 {
	margin-top: 1em;
}

#progresscontainer {
	/* width: calc(100% - 50px); */
	position: relative;
	margin: 25px;
	height: 5em;
	border: 2px solid var(--fg-color);
}

#progress_time {
	position: absolute;
	/* color: red; */
	/* font-size: var(--bg-color); */
	color: white;
	/* color: white; */
	font-size: 54px;
	margin-left: 5px;
	mix-blend-mode: difference;
}

#progress {
	background-color: var(--fg-color);
	/* width: 50%; */
	height: 100%;
	/* transition: width 1s linear; */
}


.bead {
	margin-right: 1em;
	padding: 2px 4px;
}
.done {
	text-decoration: line-through;
	color: #888;
}
/* .waiting {
	color: #888;
} */
.active {
	/* color: magenta; */
	/* border: 1px solid white; */
	background-color: var(--fg-color);
	color: var(--bg-color);
}

/***** Game config *****/
.config {
	margin-top: 2em;
}

summary {
	text-decoration: underline;
	cursor: pointer;
}

button {
	font-size: 140%;
	margin: 10px 0;
	color: var(--bg-color);
	/* color: var(--fg-color); */
}

details > :first-child {
	margin-bottom: 1em;
}

label {
	margin-bottom: 3px;
}
label > :first-child {
	display: inline-block;
	min-width: 12em;
}

input {
	width: 7em;
	font-size: 16px;
	/* color: var(--bg-color); */
	border: 2px solid #686868;
}

input[type=checkbox] {
	height: 1em;
}

label {
	display: block;
}

#magister_box {
	border: 1px dashed var(--fg-color);
	/* margin: 1em 0; */
	margin: 1em auto;
	padding: 0.8em;
	max-width: 500px;
	background-color: var(--bg-highlight);
	opacity: 40%;
	transition: opacity 0.3s ease-out;
}

#magister_box.magister_opaque, #magister_box:hover {
	opacity: 100%;
}

#magister_box > button {
	display: block;
	font-size: 100%;
	width: 100%;
	margin-top: 0;
	padding: 3px 0;
}

</style>