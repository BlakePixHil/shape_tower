// What scripts/ios-build.sh signs with: an Apple Distribution certificate and an App Store provisioning profile,
// made through the App Store Connect API and kept in a keychain of their own, so a build never stops on a
// keychain prompt. Xcode's automatic signing can't be used for the archive: it wants a development profile
// first, and that needs a registered iPhone. Safe to run again: it only makes what's missing (a new Mac makes
// its own certificate; Apple allows a few). Needs the API key (scripts/app-store-connect.ts).
//   node --experimental-strip-types scripts/ios-signing.ts

import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { AppStoreConnect, BUNDLE_ID, keyFromEnv, type Resource } from './app-store-connect.ts';

export const PROFILE = 'Shape Tower App Store';
export const KEYCHAIN = `${homedir()}/Library/Keychains/shape-tower-signing.keychain-db`;
const ENV = process.env.ASC_ENV ?? `${homedir()}/.appstoreconnect/shape-tower.env`;

const run = (cmd: string, args: string[]): string => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const sh = (cmd: string, args: string[]): void => { execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'inherit'] }); };

/** The keychain's password: made once and kept beside the key's ids (only this Mac's builds open it). */
function keychainPassword(): string {
  const have = existsSync(ENV) ? readFileSync(ENV, 'utf8').match(/^ASC_KEYCHAIN_PASSWORD=(\S+)/m)?.[1] : undefined;
  if (have) return have;
  const pw = run('openssl', ['rand', '-hex', '24']).trim();
  appendFileSync(ENV, `ASC_KEYCHAIN_PASSWORD=${pw}\n`, { mode: 0o600 });
  return pw;
}

/** The keychain exists, is unlocked and is on the search list, where Xcode looks for identities. */
export function openKeychain(): string {
  const pw = keychainPassword();
  if (!existsSync(KEYCHAIN)) sh('security', ['create-keychain', '-p', pw, KEYCHAIN]);
  sh('security', ['unlock-keychain', '-p', pw, KEYCHAIN]);
  sh('security', ['set-keychain-settings', '-t', '21600', KEYCHAIN]); // locks again after 6 hours idle
  const list = run('security', ['list-keychains', '-d', 'user']).split('\n').map(l => l.trim().replace(/^"|"$/g, '')).filter(Boolean);
  if (!list.includes(KEYCHAIN)) sh('security', ['list-keychains', '-d', 'user', '-s', ...list, KEYCHAIN]);
  return pw;
}

/** SHA-1 of the Apple Distribution identities in our keychain. */
const identities = (): string[] => [...run('security', ['find-identity', '-v', '-p', 'codesigning', KEYCHAIN]).matchAll(/\) ([0-9A-F]{40}) "Apple Distribution/g)].map(m => m[1]);

if (process.argv[1]?.endsWith('ios-signing.ts')) {
  const asc = new AppStoreConnect(keyFromEnv());
  const pw = openKeychain();
  const certs = await asc.all('/v1/certificates?filter[certificateType]=DISTRIBUTION&limit=50');
  // A certificate we hold the key for: its fingerprint is one of our identities.
  const ours = identities();
  const fingerprint = (c: Resource): string => {
    const der = Buffer.from(String(c.attributes?.certificateContent), 'base64');
    return execFileSync('openssl', ['dgst', '-sha1'], { input: der }).toString().trim().split(/\s/).pop()!.toUpperCase();
  };
  let cert = certs.find(c => ours.includes(fingerprint(c)));
  if (!cert) {
    const dir = mkdtempSync(`${tmpdir()}/st-signing-`);
    try {
      sh('openssl', ['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-keyout', `${dir}/key.pem`, '-out', `${dir}/csr.pem`, '-subj', '/CN=Shape Tower/C=AU']);
      cert = (await asc.call<{ data: Resource }>('POST', '/v1/certificates', { data: { type: 'certificates', attributes: { certificateType: 'DISTRIBUTION', csrContent: readFileSync(`${dir}/csr.pem`, 'utf8') } } }))!.data;
      writeFileSync(`${dir}/cert.der`, Buffer.from(String(cert.attributes?.certificateContent), 'base64'));
      sh('openssl', ['x509', '-inform', 'der', '-in', `${dir}/cert.der`, '-out', `${dir}/cert.pem`]);
      sh('openssl', ['pkcs12', '-export', '-inkey', `${dir}/key.pem`, '-in', `${dir}/cert.pem`, '-out', `${dir}/id.p12`, '-passout', `pass:${pw}`]);
      sh('security', ['import', `${dir}/id.p12`, '-k', KEYCHAIN, '-P', pw, '-T', '/usr/bin/codesign', '-T', '/usr/bin/security']);
      sh('security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', pw, KEYCHAIN]);
      console.log(`made the Apple Distribution certificate ${cert.id}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  // Apple's intermediate, so the identity is valid on a Mac that's never had Xcode sign for the store.
  const wwdr = `${tmpdir()}/AppleWWDRCAG3.cer`;
  if (!existsSync(wwdr)) writeFileSync(wwdr, Buffer.from(await (await fetch('https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer')).arrayBuffer()));
  try { sh('security', ['import', wwdr, '-k', KEYCHAIN]); } catch { /* already there */ }

  const [bundle] = await asc.all(`/v1/bundleIds?filter[identifier]=${BUNDLE_ID}&filter[platform]=IOS`);
  if (!bundle) throw new Error(`register ${BUNDLE_ID} first (Certificates, Identifiers & Profiles)`);
  const profiles = (await asc.all(`/v1/bundleIds/${bundle.id}/profiles?limit=50`)).filter(p => p.attributes?.name === PROFILE);
  let profile: Resource | undefined;
  for (const p of profiles) {
    const certIds = (await asc.all(`/v1/profiles/${p.id}/certificates`)).map(c => c.id);
    if (p.attributes?.profileState === 'ACTIVE' && certIds.includes(cert.id)) profile = p;
    else await asc.call('DELETE', `/v1/profiles/${p.id}`); // stale: another Mac's certificate, or expired
  }
  profile ??= (await asc.call<{ data: Resource }>('POST', '/v1/profiles', { data: {
    type: 'profiles',
    attributes: { name: PROFILE, profileType: 'IOS_APP_STORE' },
    relationships: { bundleId: { data: { type: 'bundleIds', id: bundle.id } }, certificates: { data: [{ type: 'certificates', id: cert.id }] } },
  } }))!.data;
  const uuid = String(profile.attributes?.uuid);
  for (const dir of [`${homedir()}/Library/Developer/Xcode/UserData/Provisioning Profiles`, `${homedir()}/Library/MobileDevice/Provisioning Profiles`]) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${dir}/${uuid}.mobileprovision`, Buffer.from(String(profile.attributes?.profileContent), 'base64'));
  }
  console.log(`signing ready: certificate ${cert.id}, profile "${PROFILE}" (${uuid}), keychain ${KEYCHAIN}`);
}
