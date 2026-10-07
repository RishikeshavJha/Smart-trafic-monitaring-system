/**
 * static/js/modules/api.js
 * Centralized fetch wrapper for the Smart Traffic Monitoring System API.
 *
 * Responsibilities:
 *  - Read CSRF token from <meta name="csrf-token" content="...">
 *  - Automatically attach X-CSRFToken and Content-Type headers for mutation requests (POST, PUT, DELETE, PATCH)
 *  - Handle { ok: true, data: ... } vs { ok: false, error: { code, message } } envelope
 *  - Throw clear, structured Error objects on non-ok responses
 */

/**
 * Get the current CSRF token from the DOM <meta> tag.
 * @returns {string}
 */
export function getCsrfToken() {
  const meta = document.querySelector('meta[name="csrf-token"]');
  return meta ? meta.getAttribute("content") || "" : "";
}

/**
 * Custom API Error class containing the server error code and message.
 */
export class ApiError extends Error {
  /**
   * @param {string} message
   * @param {string} [code="API_ERROR"]
   * @param {number} [status=500]
   * @param {any} [details=null]
   */
  constructor(message, code = "API_ERROR", status = 500, details = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

/**
 * Execute a standard API request returning the envelope object { ok, data, error }.
 *
 * @param {string} url - Target API URL.
 * @param {RequestInit} [options={}] - Fetch configuration options.
 * @returns {Promise<{ ok: boolean, data?: any, error?: { code: string, message: string } }>}
 */
export async function fetchApi(url, options = {}) {
  const config = { ...options };
  const method = (config.method || "GET").toUpperCase();
  const headers = new Headers(config.headers || {});

  // For mutation methods, attach CSRF and default JSON content type
  if (["POST", "PUT", "DELETE", "PATCH"].includes(method)) {
    const csrfToken = getCsrfToken();
    if (csrfToken && !headers.has("X-CSRFToken")) {
      headers.set("X-CSRFToken", csrfToken);
    }
    if (config.body && !(config.body instanceof FormData) && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
      if (typeof config.body !== "string") {
        config.body = JSON.stringify(config.body);
      }
    }
  }

  config.headers = headers;

  let response;
  try {
    response = await fetch(url, config);
  } catch (networkError) {
    return {
      ok: false,
      data: null,
      error: {
        code: "NETWORK_ERROR",
        message: networkError.message || "Network connection failed",
      },
    };
  }

  // Parse JSON response
  let json;
  try {
    json = await response.json();
  } catch (parseError) {
    return {
      ok: false,
      data: null,
      error: {
        code: "INVALID_JSON",
        message: `Server returned ${response.status} with non-JSON body`,
      },
    };
  }

  // Standard API envelope already is { ok: bool, data: any, error: { code, message } | null }
  if (json && typeof json === "object" && "ok" in json) {
    return json;
  }

  if (!response.ok) {
    return {
      ok: false,
      data: null,
      error: {
        code: `HTTP_${response.status}`,
        message: json?.message || `Request failed with status ${response.status}`,
      },
    };
  }

  return { ok: true, data: json, error: null };
}

/**
 * Execute an HTTP request against the application backend and unwrap data (throws on error).
 *
 * @param {string} url - Target API URL.
 * @param {RequestInit} [options={}] - Fetch configuration options.
 * @returns {Promise<any>} Resolves to data payload from { ok: true, data: ... }.
 * @throws {ApiError}
 */
export async function apiRequest(url, options = {}) {
  const result = await fetchApi(url, options);
  if (result.ok) {
    return result.data;
  }
  const errObj = result.error || {};
  throw new ApiError(
    errObj.message || "An unexpected error occurred.",
    errObj.code || "API_ERROR",
    500,
    errObj
  );
}

/**
 * Convenience methods
 */
export const api = {
  get: (url, options = {}) => fetchApi(url, { ...options, method: "GET" }),
  post: (url, body, options = {}) => fetchApi(url, { ...options, method: "POST", body }),
  put: (url, body, options = {}) => fetchApi(url, { ...options, method: "PUT", body }),
  delete: (url, options = {}) => fetchApi(url, { ...options, method: "DELETE" }),
};

