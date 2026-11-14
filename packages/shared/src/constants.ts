/**
 * Values that the server and the web app must agree on.
 * Keeping them in one place means a change here updates both sides.
 */

export const APP_NAME = 'Bitsomeggle';

/** Longest chat message (in characters) the server will relay. */
export const CHAT_MESSAGE_MAX_LENGTH = 1000;

/** Longest session id the server will accept. Real ids are 36-character UUIDs. */
export const SESSION_ID_MAX_LENGTH = 64;

/**
 * Longest WebRTC session description (SDP) the server will relay.
 * A normal audio + video offer from a browser is roughly 3,000 to 8,000 characters.
 */
export const SDP_MAX_LENGTH = 20_000;

/** Longest single ICE candidate line the server will relay. Real ones are around 100 to 200. */
export const ICE_CANDIDATE_MAX_LENGTH = 1000;
