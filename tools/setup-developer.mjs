// Bootstrap only the outside updater after an upstream update removed the addon.
// Does not quit, launch, sign or patch Codex. Launch in the wizard is user-owned.
import { verifyInstalledNative } from '../bin/lib/codex-native.js';
import { resolveGUIApp } from '../bin/lib/gui-updates.js';
import { resolveCodexApp } from '../bin/lib/codex.js';
import { snapshotRuntime, guiPaths, saveJSON, agentVersion, activeWorker } from '../bin/lib/gui-runtime.js';
import { installUpdateEvent, launchWizard } from '../bin/lib/update-events.js';
if(activeWorker())throw new Error('Finish the current Agent RTL operation first.');
const detected=resolveCodexApp();if(!detected)throw new Error('Codex was not found.');
const bundle=resolveGUIApp(detected.app),runtime=snapshotRuntime(bundle);
const config={schema:1,app:bundle.app,runtime,agentVersion,flow:'download-launch'};
saveJSON(guiPaths().config,config);
let healthy=false;try{verifyInstalledNative(bundle);healthy=true;}catch{}
installUpdateEvent(config,{healthy});
// An unpatched bootstrap is opened by the bounded RunAtLoad event checker.
if(healthy)await launchWizard(config);
console.log('Outside updater is ready. Download the GitHub release, then click Launch in its window. Codex is unchanged until that click.');
