export function formatDepartureTime(serviceDay: number, secondsFromMidnight: number) {
  const departureDate = new Date((serviceDay + secondsFromMidnight) * 1000);
  return new Intl.DateTimeFormat("fi-FI", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(departureDate);
}

export function formatRelativeMinutes(serviceDay: number, secondsFromMidnight: number) {
  const departureDate = new Date((serviceDay + secondsFromMidnight) * 1000);
  const diffMinutes = Math.round((departureDate.getTime() - Date.now()) / 60000);

  if (diffMinutes <= 0) {
    return "due";
  }

  if (diffMinutes === 1) {
    return "1 min";
  }

  return `${diffMinutes} min`;
}
