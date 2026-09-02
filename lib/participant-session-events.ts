'use client'

export const PARTICIPANT_SESSION_CHANNEL = 'cs2cup-participant-session-v1'
export const PARTICIPANT_SESSION_ENDED_MARKER = 'cs2cup:participant-session-ended:v1'
export const PARTICIPANT_SESSION_ENDED_MESSAGE = 'participant-session-ended:v1'

function sessionEndedMarker() {
  const nonce = window.crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)
  return `${Date.now().toString(36)}:${nonce}`
}

export function publishParticipantSessionEnded() {
  try {
    window.localStorage.setItem(PARTICIPANT_SESSION_ENDED_MARKER, sessionEndedMarker())
  } catch {
    // BroadcastChannel can still notify other tabs when storage access is denied.
  }

  try {
    const channel = new BroadcastChannel(PARTICIPANT_SESSION_CHANNEL)
    channel.postMessage(PARTICIPANT_SESSION_ENDED_MESSAGE)
    channel.close()
  } catch {
    // The storage signal remains available when BroadcastChannel is unsupported.
  }
}
