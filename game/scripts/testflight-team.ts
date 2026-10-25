// Sets up TestFlight's internal testing for the iPhone app: one internal group that gets every build as soon
// as Apple has processed it, with everyone on the App Store Connect team in it (Blake, and anyone he adds
// under Users and Access later; rerun to add them). Internal testers install from the TestFlight app with no
// Beta App Review. Safe to run again. Needs the API key (scripts/app-store-connect.ts).
//   node --experimental-strip-types scripts/testflight-team.ts

import { AppStoreConnect, keyFromEnv, type Resource } from './app-store-connect.ts';

const GROUP = 'Shape Tower team';

const asc = new AppStoreConnect(keyFromEnv());
const app = await asc.app();
const groups = await asc.all(`/v1/apps/${app.id}/betaGroups?limit=200`);
let group: Resource | undefined = groups.find(g => g.attributes?.name === GROUP);
group ??= (await asc.call<{ data: Resource }>('POST', '/v1/betaGroups', { data: {
  type: 'betaGroups',
  attributes: { name: GROUP, isInternalGroup: true, hasAccessToAllBuilds: true, feedbackEnabled: true },
  relationships: { app: { data: { type: 'apps', id: app.id } } },
} }))!.data;
const inGroup = new Set((await asc.all(`/v1/betaGroups/${group.id}/betaTesters?limit=200`)).map(t => String(t.attributes?.email).toLowerCase()));
for (const u of await asc.all('/v1/users?limit=200')) {
  const email = String(u.attributes?.username), first = u.attributes?.firstName, last = u.attributes?.lastName;
  if (inGroup.has(email.toLowerCase())) { console.log(`${email}: already testing`); continue; }
  await asc.call('POST', '/v1/betaTesters', { data: {
    type: 'betaTesters',
    attributes: { email, firstName: first, lastName: last },
    relationships: { betaGroups: { data: [{ type: 'betaGroups', id: group.id }] } },
  } });
  console.log(`${email}: added to ${GROUP}`);
}
