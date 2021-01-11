
export interface GameConfig {
	state: 'loading' | 'waiting' | 'playing' | 'paused'
	start_time: number,
	topic: string,
	meditate: boolean,
	players: number,
	rounds: number,
	seconds_per_bead: number,
	paused_progress?: number,
}

export interface State {
	game_config: GameConfig,
	_active_sessions: number,
	_magister: null | true,
	_clock_offset: number
}