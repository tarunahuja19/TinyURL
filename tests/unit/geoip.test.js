import { resolveGeoIP } from '../../src/services/geoip.js';

async function testGeoIP() {
  console.log('[Test] Running GeoIP Unit Tests...');

  // Test 1: Loopback IP
  const localRes = resolveGeoIP('127.0.0.1');
  if (localRes.country !== 'LOCAL') {
    throw new Error(`Expected LOCAL country for 127.0.0.1, got ${localRes.country}`);
  }
  console.log('✓ Loopback 127.0.0.1 resolved to LOCAL');

  // Test 2: Private IPv4
  const privateRes = resolveGeoIP('192.168.1.100');
  if (privateRes.country !== 'LOCAL') {
    throw new Error(`Expected LOCAL country for 192.168.1.100, got ${privateRes.country}`);
  }
  console.log('✓ Private IPv4 192.168.1.100 resolved to LOCAL');

  // Test 3: Public IP (Google Public DNS 8.8.8.8)
  const publicRes = resolveGeoIP('8.8.8.8');
  if (publicRes.country !== 'US') {
    throw new Error(`Expected US country for 8.8.8.8, got ${publicRes.country}`);
  }
  console.log(`✓ Public IP 8.8.8.8 resolved to country: ${publicRes.country}`);

  console.log('🎉 All GeoIP unit tests passed!\n');
}

testGeoIP().catch((err) => {
  console.error('❌ GeoIP test failed:', err);
  process.exit(1);
});
