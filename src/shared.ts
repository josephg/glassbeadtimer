
export interface GameConfig {
	state: 'loading' | 'waiting' | 'playing' | 'paused'
	start_time: number,
	topic: string,
	meditate: boolean,
	/** Post session 1 minute contemplation */
	contemplation: boolean,

	/** Number of players. Set to 1 to just set the number of rounds directly. */
	players: number,
	rounds: number,
	seconds_per_bead: number,
	/** Set to 0 to disable */
	seconds_between_bead: number,
	paused_progress?: number,
}

export interface State {
	game_config: GameConfig,
	_active_sessions: number,
	_magister: null | true,
	_clock_offset: number,
	_self_id: string,
}