<script lang="ts">
import type { HtmlTag } from 'svelte/internal';
import type { GameConfig } from './shared';
import unmuteAudio from 'unmute-ios-audio'

import * as topicIcons from './topicicons.json'
import topicSpecial from './topicspecial'

export let room: string

export let connection: 'waiting' | 'connecting' | 'connected'

export let game_config: GameConfig
// export let state // loading, waiting, playing, paused.
// export let start_time
// export let topic
// export let meditate
// export let players
// export let rounds
// export let seconds_per_bead
// export let paused_progress

export let _self_id: string
export let _active_sessions: number
export let _magister: true | null
export let _clock_offset: number
export let clock: SvelteStore<number>

// let game_completed = false // Derived from other properties

// This module shouldn't be needed, but somehow it manages to make audio work
// even when an iphone is muted.
unmuteAudio()
const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)()

interface SoundFile {
	buf: AudioBuffer | null, // null while loading.
	loaded: Promise<void>
}
const playSound = (sound: SoundFile) => {
	if (sound.buf != null && audioCtx.state === 'running') { // Do nothing while audio is loading.
		const source = audioCtx.createBufferSource()
		source.buffer = sound.buf
		source.connect(audioCtx.destination)
		source.start(0)
	}
}

const loadSound = (path: string): SoundFile => {
	let sound: Partial<SoundFile> = { buf: null }
	sound.loaded = (async () => {
		const resp = await fetch(path)
		const buf = await resp.arrayBuffer()
		sound.buf = await new Promise((resolve, reject) => {
			// Safari doesn't support the promise variant of decodeAudioData
			// https://caniuse.com/mdn-api_baseaudiocontext_decodeaudiodata_promise_syntax
			audioCtx.decodeAudioData(buf, resolve, reject)
		})
	})()
	return sound as SoundFile
}

let topic_img: HTMLElement
let topic_text: HTMLElement

const round_audio = loadSound('/lo-metal-tone.mp3')
const complete_audio = loadSound('/hi-metal-tone.mp3')


let audio_works = audioCtx.state === 'running'
if (audioCtx.state === 'suspended') {
	console.log('Audio suspended!')
	audioCtx.resume().then(() => {
		console.log('audio unsuspended!!')
		audio_works = true
	})
}

async function fix_audio() {
	// This hack brought to you by iOS. We need to send some sound to the audio
	// context from an input event handler to enable it.
	const source = audioCtx.createOscillator()

	const gain = audioCtx.createGain()
	gain.gain.setValueAtTime(0, 0)
	gain.connect(audioCtx.destination)

	source.connect(gain)
	source.start(0)
	source.stop(0)
}

let state: GameConfig['state']
$: state = game_config.state

$: console.log('Game configuration changed', game_config)

	// export let state

const ARCHETOPICS = [
  'Truth', 'Human', 'Energy', 'Beauty', 'Beginning', 'End', 'Birth', 'Death',
  'Ego', 'Attention', 'Art', 'Empathy', 'Eutopia', 'Future', 'Game', 'Gift',
  'History', 'Cosmos', 'Time', 'Life', 'Addiction', 'Paradox', 'Shadow', 'Society'
]



const fixed_rand = Math.random()
const randInt = (n: number) => Math.floor(fixed_rand * n)
function randItem<T>(arr: T[]) {return arr[randInt(arr.length)] }

$: {
	if (topic_img && topic_text) {
		const topic = game_config.topic.toLocaleLowerCase()
		const svgContent = topicIcons[topic as keyof typeof topicIcons]
		const textContent = topicSpecial[topic as keyof typeof topicSpecial]

		if (svgContent) {
			topic_img.innerHTML = svgContent
			topic_text.innerText = ''
		} else if (textContent) {
			topic_img.innerHTML = ''
			topic_text.innerText = randItem(textContent)
		} else {
			topic_img.innerHTML = ''
			topic_text.innerText = game_config.topic
		}
	}
}

$: {
	// console.log('clock', $clock)
}

// Could make configurable. Eh.
const MEDITATION_SECONDS = 60

interface GameStage {
	label: string,
	type: 'waiting' | 'bead' | 'breath' | 'meditate' | 'contemplation' | 'complete',
	duration: number,
	no_sound?: true,
	r?: number, p?: number,
	id?: string
}

let game_stages: GameStage[] = []
$: {
	game_stages = [{
		label: `${game_config.meditate ? 'Meditation' : 'Game'} starting...`,
		type: 'waiting',
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
			if (game_config.seconds_between_bead && (r > 0 || p > 0)) game_stages.push({
				label: 'Breathe',
				duration: game_config.seconds_between_bead,
				type: 'breath',
				id: `b ${r} ${p}`
			})

			game_stages.push({
				label: '',
				// label: game_config.players > 1 ? `Round ${r+1} player ${p+1}` : `Round ${r+1}`,
				duration: game_config.seconds_per_bead,
				type: 'bead', r, p,
				id: `s ${r} ${p}`
			})
		}
	}

	if (game_config.contemplation) game_stages.push({
		label: "Contemplate the game's passing",
		type: 'contemplation',
		duration: MEDITATION_SECONDS,
	})


	console.log('game stages', game_stages, game_config.seconds_between_bead)
}

let total_game_length: number
$: total_game_length = game_stages.reduce((x, s) => x + s.duration, 0)

// Used for the overall game progress indicator.
let inner_game_stages: GameStage[]
$: inner_game_stages = game_stages.filter(s => s.type === 'breath' || s.type === 'bead')
let inner_game_length: number
$: inner_game_length = inner_game_stages.reduce((x, s) => x + s.duration, 0)


// TODO: The protocol for these update methods doesn't use game_state properly.
const update_state = async (patch: Record<string, string | number | boolean | null>) => {
	patch._id = _self_id
	await fetch(`${room}/configure`, {
		method: 'POST',
		mode: 'same-origin',
		headers: {
			'content-type': 'application/json',
		},
		body: JSON.stringify(patch)
	})
}

const upd = (k: string, v: string | number | boolean | null) => () => update_state({[k]: v})

const config = (k: string): svelte.JSX.FormEventHandler<HTMLInputElement> => (e) => {
	// console.log('k', k, e.data, e.value, e.target.value, e.target.type)
	const target = e.target as HTMLInputElement
	const raw_value = target.value
	const value = target.type === 'number' ? ~~raw_value
		: target.type === 'checkbox' ? target.checked
		: raw_value
	update_state({[k]: value})
}

const roundish = (x: number) => Math.round(x * 10) / 10


const waiting_stage: GameStage = { label: 'Waiting to start', type: 'waiting', duration: Infinity }
const complete_stage: GameStage = { label: 'Game complete', type: 'complete', duration: Infinity }
const get_current_stage = (offset_ms: number): {stage: GameStage, stage_idx: number, offset_sec: number} => {
	if (state === 'waiting') return {stage: waiting_stage, stage_idx: -1, offset_sec: 0}

	let offset_sec = Math.round(offset_ms / 1000)
	for (let s = 0; s < game_stages.length; s++) {
		let stage = game_stages[s]
		if (stage.duration > offset_sec) {
			return {stage, stage_idx: s, offset_sec}
		}
		offset_sec -= stage.duration
	}
	return {
		stage: complete_stage, stage_idx: game_stages.length, offset_sec
	}
}

// Urgh kinda ugly storing state for both the index and stage itself. Better to
// have one derive the other.
let current_stage: GameStage | null = null, current_stage_idx: number = -1, offset_sec: number
$: console.log('current stage', current_stage)
// $: console.log('idx', current_stage_idx)

const tick = (play_audio: boolean, time_ms: number) => {
	// console.log('tick')
	// console.log('state', state, 'completed', state && state.complete)

	const time = state === 'playing' ? Math.max(0, time_ms + _clock_offset - game_config.start_time)
		: state === 'paused' ? game_config.paused_progress!
		: 0

	const {stage: new_stage, stage_idx: new_stage_idx, offset_sec: new_offs} = get_current_stage(time)
	// state_label = state.label

	offset_sec = new_offs
	if (new_stage !== current_stage) {
		console.log('state changed', new_stage.label, new_stage.type === 'complete', current_stage_idx, new_stage_idx)

		// This happens sometimes with other kinds of configuration changes -
		// eg if a user enters or leaves the room, or the room is reconfigured.
		// Only make a sound if the *stage* changes (and moves forward).
		let changed = current_stage == null
			|| (
				(new_stage.id ?? new_stage.type) !== (current_stage.id ?? current_stage.type)
				&& new_stage_idx > current_stage_idx
			)
		// console.log(new_stage, current_stage, changed)

		current_stage = new_stage
		current_stage_idx = new_stage_idx
		// completed = new_game_state.complete
		// if (!state.complete) round_audio.play()

		if (play_audio && !new_stage.no_sound && changed) {
			const sound = (current_stage.type === 'complete' || current_stage.type === 'contemplation')
				? complete_audio
				: round_audio

			playSound(sound)
		}
	}
}


let initial_render = false
$: {
	// Kinda gross.
	if (!initial_render && state !== 'loading') {
		tick(false, 0)
		initial_render = true
	}
}

$: {
	tick(true, $clock)
}

// let timer: number | null | any // Timeout?
// $: {
// 	// Sadly we can't use internal_state here because it generates a cyclic dependancy.
// 	let completed = current_stage ? current_stage.type === 'complete' : false
// 	// console.log('xx', state, timer, completed, current_stage)

// 	// if (state !== 'loading') tick(false)

// 	if (state === 'playing' && timer == null && !completed) {
// 		// setTimeout needed to get around some weird race condition.
// 		// There's probably better ways to structure this :/
// 		setTimeout(() => tick(false))
// 		timer = setInterval(() => {
// 			tick(true)
// 		}, 1000)
// 	} else if ((completed || state !== 'playing') && timer != null) {
// 		console.log('cancelled interval timer')
// 		clearInterval(timer)
// 		timer = null
// 	} else if (state === 'waiting' || state === 'paused') {
// 		setTimeout(() => tick(false))
// 	}
// }

let game_completed: boolean
$: {
	// console.log('updating game_completed', current_stage)
	game_completed = (state !== 'playing' || current_stage == null) ? false
	: (current_stage.type === 'complete')
}

let internal_state: GameConfig['state'] | 'completed'
$: internal_state = game_completed ? 'completed' : state

let bar_width = 0
$: bar_width = current_stage == null ? 0
	: state === 'waiting' ? 0
	: current_stage.type === 'complete' ? 100
	: 100 * offset_sec / current_stage.duration

let stage_label: string
$: stage_label = internal_state === 'waiting' ? 'Waiting to start'
	: current_stage == null ? 'unknown' : current_stage.label


const progress_class = (stage_idx: number, baseline_idx: number): 's-done' | 's-active' | 's-waiting' => {
	if (current_stage == null || baseline_idx < 0) return 's-waiting'

	return stage_idx < baseline_idx ? 's-done'
		: stage_idx === baseline_idx ? 's-active'
		: 's-waiting'
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
	<!-- <audio bind:this={round_audio} src="/lo-metal-tone.mp3" preload="auto" autoplay><track kind="captions"></audio>
	<audio bind:this={complete_audio} src="/hi-metal-tone.mp3" preload="auto"><track kind="captions"></audio> -->

	{#if !audio_works}
		<button id='fixaudio' on:click={fix_audio}>Click to unmute audio</button>
	{/if}

	{#if internal_state === 'loading'}
		<h1>Loading game state</h1>
	{:else}
		<!-- <h1>Glass Bead Game Timer</h1> -->
		<!-- <h1>{topic}</h1> -->

		<div id='topic'>
			<div id='topicimg' bind:this={topic_img}></div>
			<div id='topictext' bind:this={topic_text}></div>
		</div>

		<h1 id='stagelabel'>{stage_label}</h1>
		<div id='progresscontainer'>
			<div id='progress_time'>{((internal_state === 'playing' || internal_state === 'paused') && current_stage) ? current_stage.duration - offset_sec : ''}</div>
			<div id='progress' style='width: {bar_width}%'></div>
		</div>

		<div id='gameprogress'>
			{#each game_stages as s, i}
				{#if s.type === 'bead' || s.type === 'breath'}
					<span class={'prog-' + s.type + ' ' + progress_class(i, current_stage_idx)} style='width: {100 * s.duration / inner_game_length}%'></span>
				{/if}
			{/each}
		</div>

		{#if (_magister == null || _magister == true)}

			{#if config_open && (internal_state == 'paused' || internal_state == 'completed') }
				<button on:click={upd('state', 'waiting')} style='margin-right: 1em;'>Restart game</button>
			{/if}

			{#if internal_state == 'waiting'}
				<button on:click={upd('state', 'playing')}>Start</button>
			{:else if internal_state == 'playing'}
				<button on:click={upd('state', 'paused')}>Pause</button>
			{:else if internal_state == 'paused'}
				<button on:click={upd('state', 'playing')}>Resume</button>
			{/if}

		{/if}

		<details style='display: none;'>
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
		</details>

		{#if _magister == null || _magister == true}
			{#if config_open}
				<div class='config'>
					<!-- <summary>Game controls</summary> -->

					<p>
						{#if _magister == null}
							<!-- This will effect all players. Will you borrow power? Will you steal it? -->
						{:else}
							You are master of the games. These controls are yours alone.
						{/if}
					</p>

					<!-- {#if internal_state == 'waiting'}
						<button on:click={upd('state', 'playing')}>Start</button>
					{:else if internal_state == 'playing'}
						<button on:click={upd('state', 'paused')}>Pause</button>
					{:else if internal_state == 'paused'}
						<button on:click={upd('state', 'playing')}>Resume</button>
					{/if} -->


					<label>
						<span>Topic</span>
						<input disabled={settings_disabled} type='text' bind:value={game_config.topic} on:input={config('topic')} list='archetopics' >
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
						<span>Post game contemplation</span>
						<input disabled={settings_disabled} type='checkbox' checked={game_config.contemplation} on:input={config('contemplation')} >
					</label>

					<label>
						<span>Number of players</span>
						<input disabled={settings_disabled} type='number' pattern='[0-9]*' bind:value={game_config.players} on:input={config('players')} min=1 max=12 >
					</label>

					<label>
						<span>Number of rounds</span>
						<input disabled={settings_disabled} type='number' pattern='[0-9]*' bind:value={game_config.rounds} on:input={config('rounds')} min=1 max=20>
					</label>

					<label>
						<span>Seconds per bead</span>
						<input disabled={settings_disabled} type='number' pattern='[0-9]*' bind:value={game_config.seconds_per_bead} on:input={config('seconds_per_bead')}>
					</label>

					<label>
						<span>Seconds between beads</span>
						<input disabled={settings_disabled} type='number' pattern='[0-9]*' bind:value={game_config.seconds_between_bead} on:input={config('seconds_between_bead')}>
					</label>

					<div style='margin-top: 1em;'>
						(Total game length: {roundish(
							game_stages.reduce((x, s) => x + s.duration, 0) / 60
						)} minutes)
					</div>

					<div id='magister_box' class:magister_opaque>
						{#if _magister == null}
							<button on:click={upd('_magister', true)}>Assume the mantle of Magister Ludi</button>
							<p><i>for large games</i></p>
							<p>When present, the Magister Ludi (master of the games) has exclusive control of the game.</p>
						{:else if _magister == true}
							<button on:click={upd('_magister', null)}>Abdicate Magister Ludi status</button>
							<p>You are the master of the games. You have exclusive control over playing, pausing and configuring this game.</p>
							<p>Do not close this browser window or you will be dethroned.</p>
						{/if}
					</div>
				</div>
			{/if}
			<button id='configtoggle' class:config_open on:click={() => {config_open = !config_open}}>
				<svg xmlns="http://www.w3.org/2000/svg" viewBox="7 7 10 10">
					<path d="M 11.064453 7 C 10.935453 7 10.8275 7.0966094 10.8125 7.2246094 L 10.695312 8.2363281 C 10.211311 8.4043017 9.7738964 8.6598036 9.3945312 8.9882812 L 8.4570312 8.5839844 C 8.3390312 8.5329844 8.2026719 8.5774531 8.1386719 8.6894531 L 7.2011719 10.310547 C 7.1361719 10.421547 7.1665313 10.563625 7.2695312 10.640625 L 8.078125 11.240234 C 8.0307023 11.48651 8 11.739891 8 12 C 8 12.260109 8.0307023 12.51349 8.078125 12.759766 L 7.2695312 13.359375 C 7.1665313 13.435375 7.1371719 13.577453 7.2011719 13.689453 L 8.1386719 15.310547 C 8.2026719 15.422547 8.3390312 15.468969 8.4570312 15.417969 L 9.3945312 15.011719 C 9.7738964 15.340196 10.211311 15.595698 10.695312 15.763672 L 10.8125 16.775391 C 10.8275 16.903391 10.935453 17 11.064453 17 L 12.935547 17 C 13.064547 17 13.1725 16.903391 13.1875 16.775391 L 13.304688 15.763672 C 13.789173 15.59553 14.227802 15.340666 14.607422 15.011719 L 15.542969 15.414062 C 15.660969 15.465063 15.797328 15.420594 15.861328 15.308594 L 16.798828 13.6875 C 16.863828 13.5765 16.833469 13.434422 16.730469 13.357422 L 15.923828 12.757812 C 15.970992 12.512182 16 12.25938 16 12 C 16 11.739891 15.969298 11.48651 15.921875 11.240234 L 16.730469 10.640625 C 16.833469 10.564625 16.862828 10.422547 16.798828 10.310547 L 15.861328 8.6894531 C 15.797328 8.5774531 15.660969 8.5310312 15.542969 8.5820312 L 14.605469 8.9882812 C 14.226104 8.6598036 13.788689 8.4043017 13.304688 8.2363281 L 13.1875 7.2246094 C 13.1725 7.0966094 13.064547 7 12.935547 7 L 11.064453 7 z M 12 10 C 13.105 10 14 10.895 14 12 C 14 13.105 13.105 14 12 14 C 10.895 14 10 13.105 10 12 C 10 10.895 10.895 10 12 10 z">
					</path>
				</svg>
			</button>

			<!-- iOS eats margin at the bottom of the page for some reason -->
			<div style='padding-bottom: 4em;'></div>
		{:else}
			<!-- <p id='magister_managed'>Magister Ludi is managing this game.</p> -->
		{/if}
	{/if}
</main>

<style>

main {
	/* margin-bottom: 3em; */
	text-align: center;
}

#fixaudio {
	z-index: 1;
	color: var(--fg-color);
	background-color: var(--bg-highlight);
	position: absolute;
	top: 2px;
	width: 300px;
	padding: 0.5em 1em;
	left: 50%;
	transform: translateX(-50%);
	font-size: 130%;
}

#topicimg {
	width: 300px;
	display: inline-block;
}
#topictext:not(:empty) {
	padding: 3em 0 2em 0;
	font-size: 130%;
	font-style: italic;
}

/* .magister {
	background-color: var(--bg-highlight);
} */

/* h1 {
	margin-top: 1em;
} */

#stagelabel:empty {
	height: 1.2em;
}

#progresscontainer {
	/* width: calc(100% - 50px); */
	position: relative;
	margin: 10px 2em;
	height: 5em;
	border: 2px solid var(--fg-color);
	/* margin-bottom: 0; */
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

#gameprogress {
	/* width: 300px; */
	margin: 25px 2em; /* Sides same as #processcontainer. Bit of a hack. */
	height: 15px;
	/* background-color: blue; */
	margin-top: 0;
}

#gameprogress > span {
	display: inline-block;
	/* height: 10px; */
	background-color: var(--fg-color);
	/* border-left: 1px solid var(--bg-color);
	border-right: 1px solid var(--bg-color); */
}

/* .prog-waiting {
	height: 100%;
} */
/* .prog-meditate, .prog-contemplation {
	height: 50%;
} */
.prog-bead {
	height: 100%;
}
/* .prog-breath {
} */

.s-done {
	opacity: 20%;
}
/* .s-active {

} */
.s-waiting {
	opacity: 50%;
}


/***** Game config *****/

#configtoggle {
	/* color: var(--fg-color); */
	background-color: transparent;
	border: none;
	z-index: 2;
}
#configtoggle > svg {
	fill: #7b6565;
	width: 40px;
	height: 40px;
}

#configtoggle:not(.config_open) {
	position: fixed;
	right: 1em;
	bottom: 1em;
}

#configtoggle.config_open {
	position: absolute;
	right: 1em;
}

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

/* details > :first-child {
	margin-bottom: 1em;
} */

label {
	margin-bottom: 3px;
}
label > :first-child {
	display: inline-block;
	min-width: 14em;
}

input {
	width: 7em;
	font-size: 16px;
	/* color: var(--bg-color); */
	border: 2px solid #686868;
}

input[disabled] {
	color: #2d2d2d;
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

/* #magister_managed {
	margin: 0 auto;
	opacity: 40%;
} */

main:last-child {
	margin-bottom: 5em;
}

</style>