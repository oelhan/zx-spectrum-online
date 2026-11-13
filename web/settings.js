/* settings.js
 *
 * Per-browser settings and save states in localStorage. Storage can be
 * unavailable (private mode, blocked site data), so every call is guarded
 * and the page works without it.
 */

export function loadSetting(name, fallback) {
	try {
		return localStorage.getItem(name) ?? fallback;
	} catch {
		return fallback;
	}
}

/* Returns false if the value couldn't be stored (no storage, or full) */
export function saveSetting(name, value) {
	try {
		localStorage.setItem(name, value);
		return true;
	} catch {
		return false;
	}
}
