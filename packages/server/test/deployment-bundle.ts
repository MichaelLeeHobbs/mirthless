// ===========================================
// Deployment bundles for unit tests
// ===========================================
// EngineManager.deploy and checkScripts take a DeploymentBundle: the channel
// plus the code templates and global scripts compiled into it (#225). Tests
// build one with `bundleOf` instead of mocking the services that used to load
// templates and global scripts at deploy time.

import type { ChannelDetail } from '../src/services/channel.service.js';
import type { DeployedTemplate, DeploymentBundle } from '../src/services/deployment-record.service.js';
import type { GlobalScriptsData } from '../src/services/global-script.service.js';

/** No global scripts, all JavaScript. */
export const NO_GLOBAL_SCRIPTS: GlobalScriptsData = {
  deploy: '', undeploy: '', preprocessor: '', postprocessor: '',
  languages: { deploy: 'JAVASCRIPT', undeploy: 'JAVASCRIPT', preprocessor: 'JAVASCRIPT', postprocessor: 'JAVASCRIPT' },
};

/** A code template as a deploy compiles it in; only `code` is required. */
export function deployedTemplate(fields: Partial<DeployedTemplate> & Pick<DeployedTemplate, 'code'>): DeployedTemplate {
  return {
    id: '00000000-0000-4000-8000-0000000000aa', name: 'template', revision: 1, language: 'JAVASCRIPT',
    type: 'FUNCTION', contexts: [], ...fields,
  };
}

/** A bundle for `channel`, with no templates and empty global scripts unless given. */
export function bundleOf(
  channel: ChannelDetail,
  extra: { readonly templates?: readonly DeployedTemplate[]; readonly globalScripts?: Partial<GlobalScriptsData> } = {},
): DeploymentBundle {
  return {
    channel,
    templates: extra.templates ?? [],
    globalScripts: { ...NO_GLOBAL_SCRIPTS, ...extra.globalScripts },
  };
}
