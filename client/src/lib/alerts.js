/**
 * Shared shaping for alert rows. Every screen reads the same fields, so the
 * defaults live here rather than being repeated per component.
 */
export function normalizeAlert(alert) {
  return {
    ...alert,
    user_id: alert.user_id || "",
    user_name: alert.user_name || alert.name || "Unknown",
    phone: alert.phone || "Not provided",
    email: alert.email || "Not provided",
    trigger_type: alert.trigger_type || "Manual SOS",
    latitude: Number(alert.latitude),
    longitude: Number(alert.longitude),
    current_status: alert.status === "handled" ? "Resolved" : "Active",
  };
}

export function formatTime(isoString) {
  if (!isoString) return "—";

  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return "—";

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatCoordinates(alert) {
  if (!Number.isFinite(alert?.latitude) || !Number.isFinite(alert?.longitude)) {
    return "Location pending";
  }

  return `${alert.latitude.toFixed(5)}, ${alert.longitude.toFixed(5)}`;
}

/**
 * OpenStreetMap's embed endpoint needs no API key. The bounding box follows
 * the alert, so a moving caller keeps re-centring the frame as new location
 * pings arrive.
 */
export function osmEmbedUrl(latitude, longitude, span = 0.006) {
  const bbox = [
    longitude - span,
    latitude - span * 0.7,
    longitude + span,
    latitude + span * 0.7,
  ].join(",");

  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${latitude},${longitude}`;
}

export function osmLinkUrl(latitude, longitude) {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=16/${latitude}/${longitude}`;
}

export function googleMapsUrl(latitude, longitude) {
  return `https://maps.google.com/?q=${latitude},${longitude}`;
}
