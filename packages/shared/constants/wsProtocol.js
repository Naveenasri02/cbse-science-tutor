export const WS_MESSAGE_TYPES = {
  // Client → Server
  TEXT_CHAT: 'text_chat',
  INTERRUPT: 'interrupt',

  // Server → Client
  USER_TRANSCRIPT: 'user_transcript',
  LLM_START: 'llm_start',
  LLM_DELTA: 'llm_delta',
  LLM_DONE: 'llm_done',
  TTS_START: 'tts_start',
  TTS_DONE: 'tts_done',
  VAD_NO_SPEECH: 'vad_no_speech',
  PING: 'ping',
  ERROR: 'error',
};
