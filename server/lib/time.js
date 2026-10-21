// The hour of the day, 0 to 23, in Central Time, where the site's numbers are kept.
const hourFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', hour: '2-digit', hourCycle: 'h23' });

export const centralHour = (d = new Date()) => Number(hourFormat.format(d)) % 24;
