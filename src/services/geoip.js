import geoip from 'geoip-lite';

/**
 * Checks whether an IP address is private, loopback, or local.
 */
function isPrivateOrLoopbackIP(ip) {
  if (!ip) return true;
  const cleanIp = ip.replace(/^::ffff:/, '');

  if (
    cleanIp === '127.0.0.1' ||
    cleanIp === '::1' ||
    cleanIp === 'localhost' ||
    cleanIp === '0.0.0.0'
  ) {
    return true;
  }

  // Private IPv4 ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  const parts = cleanIp.split('.').map(Number);
  if (parts.length === 4 && !parts.some(isNaN)) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
  }

  return false;
}

/**
 * Resolves geolocation data for a given IP address using local MaxMind DB (geoip-lite).
 * Returns { country, region, city }
 */
export function resolveGeoIP(ip) {
  if (!ip || isPrivateOrLoopbackIP(ip)) {
    return { country: 'LOCAL', region: 'LOCAL', city: 'LOCAL' };
  }

  const cleanIp = ip.replace(/^::ffff:/, '');
  const geo = geoip.lookup(cleanIp);

  if (!geo) {
    return { country: 'UNKNOWN', region: 'UNKNOWN', city: 'UNKNOWN' };
  }

  return {
    country: geo.country || 'UNKNOWN',
    region:  geo.region  || 'UNKNOWN',
    city:    geo.city    || 'UNKNOWN'
  };
}
